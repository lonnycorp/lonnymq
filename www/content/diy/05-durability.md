# Durability

At this point, we have a queue that can schedule messages, prioritise urgent work, and fairly share processing capacity across channels with per-channel concurrency and rate limits. However, our messages are still not durable: dequeueing a message deletes it immediately, and the queue assumes the worker will successfully process whatever it receives. That leaves us with two important failure cases to handle:

 1. What if message processing fails due to a transient issue?
 2. What if the worker process suddenly disappears because of a power cut, OOM, segfault, or similar hard failure?

The first case can be handled without changing the queue at all. Workers can wrap message processing in a `try`/`catch`: if processing throws, the worker can either accept the failure as final or create a _new_ message with the same payload scheduled for some point in the future. If the payload includes metadata, it can also track how many attempts have already been made and use that count to decide whether to back off, retry, or abort. The payload can even include space for the worker's latest "workings", allowing the re-scheduled message to resume from an intermediate state rather than starting again from scratch.

The second case unfortunately forces us to rethink the queue itself. If a power cut, OOM, segfault, or other hard failure takes a worker offline halfway through processing, the worker never gets a chance to run any recovery logic. The work is lost forever because the message has already been popped from the queue, and the concurrency slot for that message's channel is also permanently consumed because `message_complete` is never called.

## Processing in a transaction

The first possible solution is to perform the dequeue and the message processing inside a single transaction. At first glance, this is wonderfully elegant: if the worker crashes before the transaction commits, PostgreSQL rolls the whole thing back. The message was never really deleted, the channel's concurrency count was never really incremented, and the message will still be alive when the system recovers.

Unfortunately, this elegance comes with some painful trade-offs:

 1. Global queue concurrency is constrained because every in-flight job now needs to hold a database connection open for the entire duration of processing.
 2. Channel concurrency is bounded to `1`. If processing happens in the same transaction as dequeue, both the message and its channel remain locked while the worker runs. Because dequeue uses `SKIP LOCKED`, other workers will not be able to see that locked channel at all.
 3. If the message itself is the cause of the hard crash, the system can enter an endless crash/restart/crash/restart loop, repeatedly recovering the same message and immediately dying on it again.

## Locking messages

The solution we will use instead is to lock messages explicitly. The trade-offs of wrapping dequeue and processing in a single transaction are too onerous, so rather than deleting a message when it is dequeued, we update it with an `unlock_at::BIGINT`. When choosing a channel head, we only consider messages where `unlock_at` is `NULL`, preventing locked messages from being dequeued multiple times even though they still exist in the table.

Now, in the event of a crash, the message still exists in the database. That is progress! However, it is not yet clear how the queue should access that message again.

We can solve this by modifying dequeue so it first attempts to dequeue a locked message whose `unlock_at` is less than `NOW()`. If no expired locked message is available, dequeue falls back to the familiar channel -> message path. When an expired locked message is dequeued, we do not update the channel's concurrency count: as far as the channel is concerned, that message has been running the whole time, so the concurrency slot was already consumed.

Our message table now looks like this:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL,
    content BYTEA NOT NULL,
    dequeue_at BIGINT NOT NULL,
    unlock_at BIGINT
);
```

And dequeue becomes:

```postgresql
CREATE FUNCTION message_dequeue (
    p_lock_ms BIGINT
)
RETURNS BYTEA
AS $$
DECLARE
    v_now BIGINT;
    v_channel RECORD;
    v_message RECORD;
    v_next_message RECORD;
BEGIN
    v_now := to_epoch(NOW());

    -- First try to recover an expired locked message
    SELECT "id", "content" FROM "message"
    WHERE "unlock_at" IS NOT NULL
    AND "unlock_at" <= v_now
    ORDER BY "unlock_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_message;

    IF v_message."id" IS NOT NULL THEN
        UPDATE "message"
        SET "unlock_at" = v_now + p_lock_ms
        WHERE "id" = v_message."id";

        RETURN v_message."content";
    END IF;

    -- Otherwise, dequeue from the next available channel
    SELECT
        "id",
        "head_message_id",
        "next_dequeue_at",
        "release_interval_ms",
        "current_concurrency"
    FROM "channel"
    WHERE "head_message_id" IS NOT NULL
    AND "next_dequeue_at" <= v_now
    AND "current_concurrency" < "max_concurrency"
    ORDER BY "next_dequeue_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RETURN NULL::BYTEA;
    END IF;

    SELECT "id", "content" FROM "message"
    WHERE "id" = v_channel."head_message_id"
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'head message does not exist';
    END IF;

    UPDATE "message"
    SET "unlock_at" = v_now + p_lock_ms
    WHERE "id" = v_message."id";

    SELECT "id", "dequeue_at" FROM "message"
    WHERE "channel_id" = v_channel."id"
    AND "unlock_at" IS NULL
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
                v_now + v_channel."release_interval_ms"
            )
        WHERE "id" = v_channel."id";
    END IF;

    RETURN v_message."content";
END;
$$ LANGUAGE plpgsql
```

Since dequeue no longer deletes the message, completion must now delete the message and release the channel's concurrency slot:

```postgresql
CREATE FUNCTION message_complete (
    p_id BIGINT
) RETURNS VOID AS $$
DECLARE
    v_channel RECORD;
    v_message RECORD;
BEGIN
    SELECT "id", "channel_id" FROM "message"
    WHERE "id" = p_id
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'message does not exist';
    END IF;

    SELECT "id" FROM "channel"
    WHERE "id" = v_message."channel_id"
    FOR UPDATE
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RAISE EXCEPTION 'channel does not exist';
    END IF;

    UPDATE "channel" SET
        "current_concurrency" = "current_concurrency" - 1
    WHERE "id" = v_channel."id";

    DELETE FROM "message"
    WHERE "id" = v_message."id";
END;
$$ LANGUAGE plpgsql
```

We also need to split our message indexes around the lock state. The normal dequeue index should now only contain unlocked messages:

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("channel_id" ASC, "dequeue_at" ASC, "id" ASC)
WHERE "unlock_at" IS NULL;
```

And we add a second index so expired locked messages can be found efficiently:

```postgresql
CREATE INDEX message_unlock_ix
ON "message" ("unlock_at" ASC)
WHERE "unlock_at" IS NOT NULL;
```

This solution still is not perfect. A few problems remain:

 1. If the lock duration is too short, another worker may dequeue the same message while it is still being processed, causing the same work to run twice and `message_complete` to decrement the channel's concurrency count multiple times. That would allow the channel's actual concurrency to exceed its configured limit.
 2. If the lock duration is too long, a crashed worker can leave a channel blocked for an extended period, because the locked message cannot be retried, completed, or used to release its concurrency slot until the lock expires.
 3. Jobs that cause a hard crash can still fail repeatedly. This is a little better than the transaction-based approach because the retry is delayed until the lock expires, so some other work may get through in the meantime, but the underlying crash/retry/crash loop has not been eliminated.

## Heartbeating

We can improve on (2) by using heartbeating. The idea is to set the initial lock duration relatively low, then have longer-running workers periodically extend the lock while processing continues. If the worker is taken offline by a crash, the heartbeat stops and the lock expires shortly afterwards, allowing the message to be retried without leaving the channel blocked for too long. Technically this also helps with (1), because a healthy worker should keep `unlock_at` future-dated, but it does not solve it reliably: if the heartbeat interval fails for any reason, the message can still become visible to another worker while it is being processed.

```postgresql
CREATE FUNCTION message_heartbeat (
    p_id BIGINT,
    p_lock_ms BIGINT
) RETURNS VOID AS $$
DECLARE
    v_now BIGINT;
BEGIN
    v_now := to_epoch(NOW());

    UPDATE "message"
    SET "unlock_at" = v_now + p_lock_ms
    WHERE "id" = p_id;
END;
$$ LANGUAGE plpgsql
```

## Attempt tracking

Luckily, we can solve (1) and (3) in one fell swoop by pulling attempt tracking into the queue itself. Instead of asking users to track attempts inside their payload metadata, we add a `num_attempts` field to `message` and make the queue responsible for maintaining it. Every dequeue increments `num_attempts`, including dequeues of expired locked messages.

This changes how workers should handle processing exceptions. Rather than "completing" the current message and creating a new one with the same payload (as we did previously), the worker should re-use the same message by _deferring_ it via `message_defer` (defined below). Deferring a message removes its lock, releases the channel's concurrency slot, and re-schedules the same message for some point in the future. Because the same row is preserved, `num_attempts` is preserved too. For large payloads, this also avoids copying the same content back and forth between the worker and the database just to schedule a retry.

Now, regardless of whether processing fails because of a caught transient exception or because the message causes a hard crash such as an OOM, each retry increments the attempt count. Workers can use that count to decide when to back off, when to retry, and when to give up by completing the message. This solves (3): crash/retry/crash loops can be bounded by a queue-managed attempt counter rather than running forever.

This also solves (1) indirectly. When dequeue returns a message, it also returns the message's current `num_attempts`. Calls to `message_complete` and `message_defer` must pass that value back to the queue, which verifies that it still matches the value in the database. If it does not match, the message's lock has expired and the message has already been re-dequeued elsewhere. In that case, the operation should fail rather than decrementing the channel's concurrency count a second time and corrupting our concurrency accounting.

Our final dequeue now increments and returns `num_attempts`:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    channel_id BIGINT NOT NULL,
    content BYTEA NOT NULL,
    state BYTEA,
    num_attempts BIGINT NOT NULL DEFAULT 0,
    dequeue_at BIGINT NOT NULL,
    unlock_at BIGINT
);
```

```postgresql
CREATE FUNCTION message_dequeue (
    p_lock_ms BIGINT
)
RETURNS TABLE (
    id BIGINT,
    content BYTEA,
    state BYTEA,
    num_attempts BIGINT
) AS $$
DECLARE
    v_now BIGINT;
    v_channel RECORD;
    v_message RECORD;
    v_next_message RECORD;
BEGIN
    v_now := to_epoch(NOW());

    SELECT "id", "content", "state", "num_attempts" FROM "message"
    WHERE "unlock_at" IS NOT NULL
    AND "unlock_at" <= v_now
    ORDER BY "unlock_at" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_message;

    IF v_message."id" IS NOT NULL THEN
        UPDATE "message" SET
            "unlock_at" = v_now + p_lock_ms,
            "num_attempts" = v_message."num_attempts" + 1
        WHERE "id" = v_message."id";

        RETURN QUERY SELECT
            v_message."id",
            v_message."content",
            v_message."state",
            v_message."num_attempts" + 1;
        RETURN;
    END IF;

    SELECT
        "id",
        "head_message_id",
        "next_dequeue_at",
        "release_interval_ms",
        "current_concurrency"
    FROM "channel"
    WHERE "head_message_id" IS NOT NULL
    AND "next_dequeue_at" <= v_now
    AND "current_concurrency" < "max_concurrency"
    ORDER BY "next_dequeue_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RETURN;
    END IF;

    SELECT "id", "content", "state", "num_attempts" FROM "message"
    WHERE "id" = v_channel."head_message_id"
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'head message does not exist';
    END IF;

    UPDATE "message" SET
        "unlock_at" = v_now + p_lock_ms,
        "num_attempts" = v_message."num_attempts" + 1
    WHERE "id" = v_message."id";

    SELECT "id", "dequeue_at" FROM "message"
    WHERE "channel_id" = v_channel."id"
    AND "unlock_at" IS NULL
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
                v_now + v_channel."release_interval_ms"
            )
        WHERE "id" = v_channel."id";
    END IF;

    RETURN QUERY SELECT
        v_message."id",
        v_message."content",
        v_message."state",
        v_message."num_attempts" + 1;
END;
$$ LANGUAGE plpgsql
```

Completion now validates the attempt count before deleting the message and releasing the channel's concurrency slot:

```postgresql
CREATE FUNCTION message_complete (
    p_id BIGINT,
    p_num_attempts BIGINT
) RETURNS VOID AS $$
DECLARE
    v_channel RECORD;
    v_message RECORD;
BEGIN
    SELECT "id", "channel_id", "num_attempts", "unlock_at"
    FROM "message"
    WHERE "id" = p_id
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'message does not exist';
    END IF;

    IF v_message."unlock_at" IS NULL OR v_message."num_attempts" <> p_num_attempts THEN
        RAISE EXCEPTION 'message state is no longer valid';
    END IF;

    SELECT "id" FROM "channel"
    WHERE "id" = v_message."channel_id"
    FOR UPDATE
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RAISE EXCEPTION 'channel does not exist';
    END IF;

    UPDATE "channel" SET
        "current_concurrency" = "current_concurrency" - 1
    WHERE "id" = v_channel."id";

    DELETE FROM "message"
    WHERE "id" = v_message."id";
END;
$$ LANGUAGE plpgsql
```

And deferral does the same validation, but keeps the message row alive, removes its lock, releases the concurrency slot, and schedules it for later:

```postgresql
CREATE FUNCTION message_defer (
    p_id BIGINT,
    p_num_attempts BIGINT,
    p_dequeue_at TIMESTAMPTZ,
    p_state BYTEA DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_dequeue_at BIGINT;
    v_channel RECORD;
    v_message RECORD;
BEGIN
    v_dequeue_at := CASE
        WHEN p_dequeue_at IS NULL
        THEN to_epoch(NOW())
        ELSE to_epoch(p_dequeue_at)
    END;

    SELECT "id", "channel_id", "num_attempts", "unlock_at"
    FROM "message"
    WHERE "id" = p_id
    FOR UPDATE
    INTO v_message;

    IF v_message."id" IS NULL THEN
        RAISE EXCEPTION 'message does not exist';
    END IF;

    IF v_message."unlock_at" IS NULL OR v_message."num_attempts" <> p_num_attempts THEN
        RAISE EXCEPTION 'message state is no longer valid';
    END IF;

    SELECT
        "id",
        "head_message_id",
        "head_message_dequeue_at",
        "last_dequeue_at",
        "next_dequeue_at",
        "release_interval_ms",
        "current_concurrency"
    FROM "channel"
    WHERE "id" = v_message."channel_id"
    FOR UPDATE
    INTO v_channel;

    IF v_channel."id" IS NULL THEN
        RAISE EXCEPTION 'channel does not exist';
    END IF;

    UPDATE "message" SET
        "unlock_at" = NULL,
        "state" = COALESCE(p_state, "state"),
        "dequeue_at" = v_dequeue_at
    WHERE "id" = v_message."id";

    IF
        v_channel."head_message_id" IS NULL OR
        v_dequeue_at < v_channel."head_message_dequeue_at"
    THEN
        UPDATE "channel" SET
            "current_concurrency" = v_channel."current_concurrency" - 1,
            "head_message_id" = v_message."id",
            "head_message_dequeue_at" = v_dequeue_at,
            "next_dequeue_at" = GREATEST(
                v_dequeue_at,
                v_channel."last_dequeue_at" + v_channel."release_interval_ms"
            )
        WHERE "id" = v_channel."id";
    ELSE
        UPDATE "channel" SET
            "current_concurrency" = v_channel."current_concurrency" - 1
        WHERE "id" = v_channel."id";
    END IF;
END;
$$ LANGUAGE plpgsql
```

## Intermediate state

Adding `state` to the message gives us a useful free win: `message_defer` can optionally save the worker's latest progress before releasing the lock and re-scheduling the message. For costly processing tasks, this means a transient error does not necessarily force us to start from scratch. The next dequeue receives both the original `content` and the latest `state`, giving the worker enough context to resume from a known checkpoint.

This can also be used to build cooperative message processors within a concurrency-constrained channel. A long-running task can do a bounded amount of work, save its progress into `state`, then defer itself so another message from the same channel has an opportunity to run. In effect, the queue can support tasks that voluntarily yield without giving up durability, retry accounting, or per-channel fairness.

## Repeating / Periodic messages

Most message queues offer some sort of explicit mechanism for scheduling periodic or repeating messages. Similar to priority, LonnyMQ does not provide a dedicated primitive for this, but it can still support the feature using the mechanisms we have already built.

The trick is to construct a message that never completes. Every time it is processed, the worker enqueues a separate task message containing the actual work to be done, then defers the repeating message for some point in the future. Because the repeating message is never completed, and because our durability mechanisms preserve locked and deferred messages across crashes, the schedule-driving message will never be lost.
