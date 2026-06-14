# Prioritisation

We can now consider priority: under backlogged conditions, how do we make sure the most important messages are processed first?

The obvious solution is to add a `priority::INTEGER` field to `message`:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    content BYTEA NOT NULL,
    dequeue_at TIMESTAMPTZ NOT NULL,
    priority INTEGER NOT NULL
);
```

Then dequeue can order available messages by `(priority, dequeue_at, id)`. This means priority wins first, but within a priority bucket we still process the oldest ready messages first:

```postgresql
CREATE FUNCTION message_dequeue ()
RETURNS BYTEA
AS $$
DECLARE
    v_message RECORD;
BEGIN
    -- Capture a message
    SELECT "id", "content" FROM "message"
    WHERE "dequeue_at" <= NOW()
    ORDER BY "priority" ASC, "dequeue_at" ASC, "id" ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
    INTO v_message;

    -- If there is nothing to capture return a NULL
    IF v_message."id" IS NULL THEN
        RETURN NULL::BYTEA;
    END IF;

    -- If we've captured a message, delete it and return its content
    DELETE FROM "message"
    WHERE "id" = v_message."id";

    RETURN v_message."content";
END;
$$ LANGUAGE plpgsql
```

We _could_ do this, and it gives us the behaviour we want: messages are only dequeued once their `dequeue_at` has elapsed, and if there is a backlog, the highest priority messages are processed first. Within each priority bucket, older available messages still run first. In this example, lower `priority` values represent higher priority.

The problem is that there is no obvious way to index this query that is immune from pathological cases. We can see this by walking through a few options.

## Separate indexes

We could define two separate indexes: one over `dequeue_at` to find messages that are ready, and another over `(priority, dequeue_at, id)` to support priority ordering.

```postgresql
CREATE INDEX message_dequeue_at_ix
ON "message" ("dequeue_at" ASC);

CREATE INDEX message_priority_dequeue_ix
ON "message" ("priority" ASC, "dequeue_at" ASC, "id" ASC);
```

With this shape, dequeue can efficiently determine which messages are ready using `message_dequeue_at_ix`, and it can scan messages in priority order using `message_priority_dequeue_ix`. The issue is that combining those two facts usually means scanning through priority-ordered rows until PostgreSQL finds one that is also in the ready set.

The pathological case is clear: if we have a large number of future-dated, high-priority messages, dequeue may need to scan a significant portion of the table before finding a lower-priority message that is actually available.

## A compound index 

So two separate indexes have a bad worst case. Can we fix this with a compound index?

If we use the index:

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("dequeue_at" ASC, "priority" ASC, "id" ASC);
```

This looks promising, but it does not give us the ordering we need. The index can help find rows where `dequeue_at <= NOW()`, but the returned rows are ordered by `(dequeue_at, priority, id)`, not `(priority, dequeue_at, id)`.

That means a pathological case emerges again, this time when there is a large backlog of available messages. The database may need to scan through many ready rows before it can identify the highest-priority one.

### A better compound index?

What if we flip the compound index around?

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("priority" ASC, "dequeue_at" ASC, "id" ASC);
```

This is better, and in systems where the number of distinct priority levels is tightly bounded, it may be good enough. Dequeue can inspect each priority group, highest priority first, until it finds a message whose `dequeue_at` has elapsed.

A pathological case still exists: a large number of future-dated messages spread across many high-priority buckets can force dequeue to walk through many priority groups before reaching a lower-priority message that is ready.

However, unlike the earlier cases, this cost can be bounded if the number of distinct priorities is small and controlled.

## Explicit marking

Another possible strategy is to run a background process that explicitly marks messages as ready using an `is_ready` column.

If such a process existed, we could index not-yet-ready messages by `dequeue_at` so the background process can efficiently find messages that have become ready:

```postgresql
CREATE INDEX message_mark_ix
ON "message" ("dequeue_at" ASC)
WHERE NOT is_ready;
```

Correspondingly, dequeue could use a partial index containing only ready messages, ordered by priority and then age:

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("priority" ASC, "dequeue_at" ASC, "id" ASC)
WHERE is_ready;
```

This can work, but it adds a lot of machinery. We would need to manage a background process, reason about how quickly it marks messages as ready, and ensure that it does not become the bottleneck that starves workers upstream. That is more complexity than I want to take on here.

## No priority

The final solution, and the one we will use going forward, is to implement priority by not adding a priority column at all.

No, I have not had a brain injury - thanks for asking. What I am actually talking about is overloading `dequeue_at` so it acts as both the scheduling field and the priority field. To do that, we change `dequeue_at` from a `TIMESTAMPTZ` to a `BIGINT` Unix timestamp with millisecond precision. That gives us a wider and more convenient value space: we can assign values that are historical, zero, or even negative.

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    content BYTEA NOT NULL,
    dequeue_at BIGINT NOT NULL
);
```

We also introduce a helper function to convert ordinary timestamps into that representation:

```postgresql
CREATE FUNCTION to_epoch (
    p_timestamp TIMESTAMPTZ
) RETURNS BIGINT AS $$
BEGIN
    RETURN FLOOR(EXTRACT(EPOCH FROM p_timestamp) * 1000)::BIGINT;
END;
$$ LANGUAGE plpgsql
```

From this point forward, `dequeue_at` will use this `BIGINT` representation. Normal messages can use a `dequeue_at` equivalent to `to_epoch(NOW())` or some point in the future. Higher-priority messages can use historical or negative `dequeue_at` values, causing them to sort ahead of ordinary ready messages without adding another ordering dimension.

This keeps dequeue as a simple ordered index lookup, which is exactly the shape we already know how to make fast. The one thing we give up is the ability to describe work that is both high priority and scheduled for the future - although the idea of "urgent, but later" is already a little contradictory. In this model, prioritised messages are messages that should run as soon as possible.
