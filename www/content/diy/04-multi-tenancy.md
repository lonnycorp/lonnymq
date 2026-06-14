# Multi-tenancy

We can now add multi-tenancy support to the queue: the ability for one queue to serve multiple "tenants" without allowing any single tenant to monopolise workers and starve everyone else of compute.

Imagine we used our current queue for a video-processing service where customers submit expensive transcoding jobs. If one customer submits a large backlog, every other customer's work gets stuck behind it. The queue is technically doing the right thing - processing messages in order - but the product experience is terrible because one tenant can dominate the shared worker pool.

## Round robin

What we want instead is for dequeue to happen in a round-robin fashion across tenants.

To accomplish this, a single message table is no longer enough. We need a small amount of machinery to track tenant state.

We will define the concept of a "Channel": a lightweight virtual queue that serves a particular tenant. Each message belongs to a channel, and dequeue chooses between channels rather than choosing directly from the global message table.

To get started, we create a channel table:

```postgresql
CREATE TABLE channel (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    head_message_id BIGINT,
    head_message_dequeue_at BIGINT,
    last_dequeue_at BIGINT NOT NULL DEFAULT 0,
    next_dequeue_at BIGINT
);
```

And we add a `channel_id` column to `message` so each message belongs to a channel:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL,
    content BYTEA NOT NULL,
    dequeue_at BIGINT NOT NULL
);
```

The idea is straightforward enough. Each channel holds a reference to the head message of its virtual queue, if one exists. It also stores that head message's own `dequeue_at`, plus the time the channel should next be eligible for dequeue. Dequeue selects the channel with the oldest `next_dequeue_at`, pops that channel's head message, and then chooses a new head message for the channel. As part of that update, it records `last_dequeue_at` and recalculates `next_dequeue_at`.

Dequeue now looks like this:

```postgresql
CREATE FUNCTION message_dequeue ()
RETURNS BYTEA
AS $$
DECLARE
    v_now BIGINT;
    v_channel RECORD;
    v_message RECORD;
    v_next_message RECORD;
BEGIN
    v_now := to_epoch(NOW());

    -- Capture the channel whose head message is next in line
    SELECT
        "id",
        "head_message_id",
        "next_dequeue_at"
    FROM "channel"
    WHERE "head_message_id" IS NOT NULL
    AND "next_dequeue_at" <= v_now
    ORDER BY "next_dequeue_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_channel;

    -- If there is no channel ready to service, return a NULL
    IF v_channel."id" IS NULL THEN
        RETURN NULL::BYTEA;
    END IF;

    -- Capture the head message from the selected channel
    SELECT "id", "content" FROM "message"
    WHERE "id" = v_channel."head_message_id"
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'head message does not exist';
    END IF;

    -- Delete the message from the queue
    DELETE FROM "message"
    WHERE "id" = v_message."id";

    -- Find the next message from the same channel
    SELECT "id", "dequeue_at" FROM "message"
    WHERE "channel_id" = v_channel."id"
    ORDER BY "dequeue_at" ASC, "id" ASC
    LIMIT 1
    INTO v_next_message;

    IF v_next_message."id" IS NULL THEN
        UPDATE "channel" SET
            "head_message_id" = NULL,
            "head_message_dequeue_at" = NULL,
            "last_dequeue_at" = v_now,
            "next_dequeue_at" = NULL
        WHERE "id" = v_channel."id";
    ELSE
        UPDATE "channel" SET
            "head_message_id" = v_next_message."id",
            "head_message_dequeue_at" = v_next_message."dequeue_at",
            "last_dequeue_at" = v_now,
            "next_dequeue_at" = GREATEST(
                v_next_message."dequeue_at",
                v_now
            )
        WHERE "id" = v_channel."id";
    END IF;

    RETURN v_message."content";
END;
$$ LANGUAGE plpgsql
```

If `next_dequeue_at` was naively set to the new head message's `dequeue_at`, then one channel could still dominate the queue by holding lots of messages with very low `dequeue_at` values. Instead, after a dequeue we set it to `GREATEST(next_head.dequeue_at, NOW())`. That preserves ordering within each channel while still ensuring channels take turns.

At first glance, `last_dequeue_at` looks redundant. We set it during dequeue, but the dequeue function never actually reads it. Why keep it around?

We need to keep both pieces of state around for message creation. If a new message is inserted with a `dequeue_at` before the current channel head's `dequeue_at`, it needs to become the new head. When that happens, `channel.next_dequeue_at` still has to respect round-robin semantics, so it must be computed relative to the channel's previous dequeue time.

That means `message_create` is now responsible for more than just inserting a row - we also update the channel's head metadata whenever the new message becomes the first message that channel should release.

```postgresql
CREATE FUNCTION message_create (
    p_content BYTEA,
    p_channel TEXT,
    p_dequeue_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
    v_dequeue_at BIGINT;
    v_message RECORD;
    v_channel RECORD;
BEGIN
    v_dequeue_at := CASE
        WHEN p_dequeue_at IS NULL
        THEN to_epoch(NOW())
        ELSE to_epoch(p_dequeue_at)
    END;

    SELECT
        "id",
        "head_message_id",
        "head_message_dequeue_at",
        "last_dequeue_at",
        "next_dequeue_at"
    FROM "channel"
    WHERE "name" = p_channel
    FOR UPDATE
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RAISE EXCEPTION 'channel does not exist';
    END IF;

    INSERT INTO "message" (content, channel_id, dequeue_at)
    VALUES (p_content, v_channel."id", v_dequeue_at)
    RETURNING "id"
    INTO v_message;

    IF
        v_channel."head_message_id" IS NULL OR
        v_dequeue_at < v_channel."head_message_dequeue_at"
    THEN
        UPDATE "channel" SET
            "head_message_id" = v_message."id",
            "head_message_dequeue_at" = v_dequeue_at,
            "next_dequeue_at" = GREATEST(
                v_dequeue_at,
                v_channel."last_dequeue_at"
            )
        WHERE "id" = v_channel."id";
    END IF;
END;
$$ LANGUAGE plpgsql
```

To stay true to our goal of keeping dequeue cheap, the indexes need to line up with the new access patterns.

We add an index on channel name so message creation can resolve or create channels efficiently:

```postgresql
CREATE UNIQUE INDEX channel_name_ix
ON "channel" ("name" ASC);
```

We add an index on channels so dequeue can find the next eligible channel:

```postgresql
CREATE INDEX channel_dequeue_ix
ON "channel" ("next_dequeue_at" ASC, "id" ASC)
WHERE "head_message_id" IS NOT NULL;
```

And we tweak the message dequeue index so messages can be scanned within a single channel:

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("channel_id" ASC, "dequeue_at" ASC, "id" ASC);
```

## Deadlocks

These changes look innocent, but they introduce one important piece of hidden complexity: deadlocks.

We must be careful about which queue actions we run inside a single transaction. For example, imagine transaction A runs:

 1. Message create on Channel "Foo"
 2. Message create on Channel "Bar"

While transaction B runs:

 1. Message create on Channel "Bar"
 2. Message create on Channel "Foo"

This can deadlock: A waits for B to release "Bar", while B waits for A to release "Foo". If we create messages for multiple channels in one transaction, we need to acquire those channels in a consistent order.

Dequeues introduce a slightly different problem. A dequeue locks whichever channel happens to be next according to the scheduler, so the caller cannot know ahead of time which channel lock it will acquire. If we run two dequeues inside the same transaction, we may lock two channels in an order we cannot predict. That can still deadlock with another transaction that is creating messages in multiple channels, even if that creation transaction acquires channels in a consistent order.

For this reason, dequeue should not be bundled together with other queue operations inside a larger transaction.

## Concurrency constraints

One of the most useful features of a multi-tenant queue is the ability to constrain each channel to a specific concurrency. In other words, we want to ensure that at most `N` jobs from a given channel are running simultaneously across the worker fleet.

This is a relatively straightforward addition now that channels exist. We add `max_concurrency::INTEGER NOT NULL` and `current_concurrency::INTEGER NOT NULL` fields to the channel:

```postgresql
CREATE TABLE channel (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    max_concurrency INTEGER NOT NULL DEFAULT 2147483647,
    current_concurrency INTEGER NOT NULL DEFAULT 0,
    head_message_id BIGINT,
    head_message_dequeue_at BIGINT,
    last_dequeue_at BIGINT NOT NULL DEFAULT 0,
    next_dequeue_at BIGINT
);
```

Then we make three small changes:

 1. When we dequeue a message from a channel, increment the channel's `current_concurrency`.
 2. When processing finishes, call `message_complete` (defined below) for the channel to decrement `current_concurrency`.
 3. When looking for the next channel to dequeue from, only consider channels where `current_concurrency < max_concurrency`.

The dequeue function now looks like:

```postgresql
CREATE FUNCTION message_dequeue ()
RETURNS TABLE (
    channel TEXT,
    content BYTEA
)
AS $$
DECLARE
    v_now BIGINT;
    v_channel RECORD;
    v_message RECORD;
    v_next_message RECORD;
BEGIN
    v_now := to_epoch(NOW());

    -- Capture the channel whose head message is next in line
    SELECT
        "id",
        "name",
        "head_message_id",
        "next_dequeue_at",
        "current_concurrency"
    FROM "channel"
    WHERE "head_message_id" IS NOT NULL
    AND "next_dequeue_at" <= v_now
    AND "current_concurrency" < "max_concurrency"
    ORDER BY "next_dequeue_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_channel;

    -- If there is no channel ready to service, return a NULL
    IF v_channel."id" IS NULL THEN
        RETURN QUERY SELECT NULL::TEXT, NULL::BYTEA;
        RETURN;
    END IF;

    -- Capture the head message from the selected channel
    SELECT "id", "content" FROM "message"
    WHERE "id" = v_channel."head_message_id"
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'head message does not exist';
    END IF;

    -- Delete the message from the queue
    DELETE FROM "message"
    WHERE "id" = v_message."id";

    -- Find the next message from the same channel
    SELECT "id", "dequeue_at" FROM "message"
    WHERE "channel_id" = v_channel."id"
    ORDER BY "dequeue_at" ASC, "id" ASC
    LIMIT 1
    INTO v_next_message;

    IF v_next_message."id" IS NULL THEN
        UPDATE "channel" SET
            "current_concurrency" = v_channel."current_concurrency" + 1,
            "head_message_id" = NULL,
            "head_message_dequeue_at" = NULL,
            "last_dequeue_at" = v_now,
            "next_dequeue_at" = NULL
        WHERE "id" = v_channel."id";
    ELSE
        UPDATE "channel" SET
            "current_concurrency" = v_channel."current_concurrency" + 1,
            "head_message_id" = v_next_message."id",
            "head_message_dequeue_at" = v_next_message."dequeue_at",
            "last_dequeue_at" = v_now,
            "next_dequeue_at" = GREATEST(
                v_next_message."dequeue_at",
                v_now
            )
        WHERE "id" = v_channel."id";
    END IF;

    RETURN QUERY SELECT v_channel."name", v_message."content";
    RETURN;
END;
$$ LANGUAGE plpgsql
```

When processing finishes, we complete the work by decrementing the concurrency count for the channel. In practice, the dequeue API should return the channel alongside the message content so the worker can pass it back once processing has finished:

```postgresql
CREATE FUNCTION message_complete (
    p_channel TEXT
) RETURNS VOID AS $$
BEGIN
    UPDATE "channel" SET
        "current_concurrency" = "current_concurrency" - 1
    WHERE "name" = p_channel;
END;
$$ LANGUAGE plpgsql
```

The channel dequeue index also needs to match the new eligibility check:

```postgresql
CREATE INDEX channel_dequeue_ix
ON "channel" ("next_dequeue_at" ASC, "id" ASC)
WHERE "head_message_id" IS NOT NULL
AND "current_concurrency" < "max_concurrency";
```

## Rate limiting

Another useful feature we get from this machinery is per-channel rate limiting. We add a `release_interval_ms::INTEGER NOT NULL` field to the channel, describing the minimum time that must elapse between messages being released from that channel. A value of `0` preserves the current behaviour, allowing a channel to release messages back-to-back whenever concurrency permits.

```postgresql
CREATE TABLE channel (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    max_concurrency INTEGER NOT NULL DEFAULT 2147483647,
    release_interval_ms INTEGER NOT NULL DEFAULT 0,
    current_concurrency INTEGER NOT NULL DEFAULT 0,
    head_message_id BIGINT,
    head_message_dequeue_at BIGINT,
    last_dequeue_at BIGINT NOT NULL DEFAULT 0,
    next_dequeue_at BIGINT
);
```

This only changes how we calculate `next_dequeue_at`. After a dequeue, we use the current time plus the release interval:

```postgresql
    GREATEST(
        v_next_message."dequeue_at",
        v_now + v_channel."release_interval_ms"
    )
```

When creating a new head message, we use the channel's previous dequeue time plus the release interval:

```postgresql
    GREATEST(
        v_dequeue_at,
        v_channel."last_dequeue_at" + v_channel."release_interval_ms"
    )
```
