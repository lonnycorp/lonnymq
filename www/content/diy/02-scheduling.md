# Scheduling

We now have a performant, albeit bare-bones, PostgreSQL message queue. This is where many articles stop, but we can go further. The first improvement is simple scheduling: the ability to specify a timestamp before which a message should not be dequeued.

To do this, we make a small addition to our message table: a `dequeue_at` field:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    content BYTEA NOT NULL,
    dequeue_at TIMESTAMPTZ NOT NULL
);
```

Our message creation function now accepts a scheduled dequeue time. If one is not provided, we default to `NOW()`:

```postgresql
CREATE FUNCTION message_create (
    p_content BYTEA,
    p_dequeue_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
    v_dequeue_at TIMESTAMPTZ;
BEGIN
    v_dequeue_at := COALESCE(p_dequeue_at, NOW());

    INSERT INTO "message" (content, dequeue_at)
    VALUES (p_content, v_dequeue_at);
END;
$$ LANGUAGE plpgsql
```

Dequeue is now changed to only return messages that have elapsed their scheduled waiting time. We will now also perform a lexicographical sort by `dequeue_at` and then `id` to ensure the oldest messages are processed first.

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
    ORDER BY "dequeue_at" ASC, "id" ASC
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

Keen-eyed observers may already be groaning. In the previous section, I warned against using timestamps for FIFO ordering, and now it looks like I am doing exactly that. However, within a transaction, `NOW()` is stable. All messages enqueued in the same transaction will have the same `dequeue_at`, so their relative order is still determined by `id`. FIFO ordering within a single transaction is preserved.

One thing is still missing: an explicit index. Without it, dequeue would need to scan through the table to find the lowest available `dequeue_at`. We avoid that with:

```postgresql
CREATE INDEX message_dequeue_ix
ON "message" ("dequeue_at" ASC, "id" ASC);
```
