# Building LonnyMQ

PostgreSQL can work surprisingly well as a message queue. There are already plenty of articles showing how to build a basic queue with `SELECT FOR UPDATE SKIP LOCKED`.

I want to talk through my own experience building a PostgreSQL-backed message queue that goes beyond a simple FIFO implementation and explores features such as:
 - Scheduled messages
 - Message prioritisation
 - Multi-tenant fairness and concurrency constraints
 - Durability

The goal is to keep the solution small without compromising dequeue performance: every dequeue should be served by an index lookup, not a linear scan.

## Why PostgreSQL?

Before we dive in, it is worth answering the obvious question: "Why use PostgreSQL as a message queue instead of something like Redis or RabbitMQ?" PostgreSQL has a few useful properties:
 1. Assuming you are already using PostgreSQL (not unlikely), it keeps your infrastructure simple and cheap.
 2. Queue actions can piggy-back on existing database transactions, allowing them to happen in lock-step with your business logic and eliminating a large class of race conditions that appear when queue state lives somewhere else.
 3. Raw message throughput can easily exceed `1_000` messages per second, which is plenty fast for many workloads.
 4. If queue state lives in the database, it can be inspected and monitored using SQL queries and familiar database tooling.

## Our implementation

We will implement our message queue with `plpgsql` functions that drive queue actions such as message create/dequeue. There are a few benefits to keeping the core logic in the database:
 1. Language-specific implementations become lightweight bindings. The business logic lives in installed `plpgsql` functions, and each client only needs to pass data in and out.
 2. Multi-step queue actions do not need to shuttle intermediate state back and forth over the network.
 3. Each function call runs inside a single transaction context, so multi-step actions can remain atomic without every client binding needing explicit transaction support.

## A simple FIFO queue (quick refresher)

We will begin by building a simple, performant FIFO queue that uses `FOR UPDATE SKIP LOCKED`.

We can begin by creating a simple table to store our messages:

```postgresql
CREATE TABLE message (
    id BIGSERIAL PRIMARY KEY,
    content BYTEA NOT NULL
);
```

Enqueueing a message is just an insert. Using a `plpgsql` function feels like overkill here, but it gives us a consistent shape to build on:

```postgresql
CREATE FUNCTION message_create (
    p_content BYTEA
) RETURNS VOID AS $$
BEGIN
    INSERT INTO "message" (content)
    VALUES (p_content);
END;
$$ LANGUAGE plpgsql
```

A dequeue captures a message using `FOR UPDATE` so concurrent dequeues cannot return the same row. `SKIP LOCKED` prevents workers from being head-of-line blocked by a row another worker has already locked. Ordering by `id` gives us FIFO behaviour for messages created within a transaction because IDs assigned within that transaction are monotonic. It is also efficient because the primary key gives us a B-tree index that can find the lowest `id` quickly.

```postgresql
CREATE FUNCTION message_dequeue ()
RETURNS BYTEA
AS $$
DECLARE
    v_message RECORD;
BEGIN
    -- Capture a message
    SELECT "id", "content" FROM "message"
    ORDER BY "id" ASC
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

Using `BIGSERIAL` is better than using a timestamp field for FIFO ordering. If we used a `created_at` timestamp set to `CURRENT_TIMESTAMP()`, all messages created within the same transaction would have the same timestamp, so their order would be undefined. IDs assigned by `BIGSERIAL` are monotonic within the transaction, giving those messages a stable relative order. `CLOCK_TIMESTAMP()` helps a little, but still leaves us vulnerable to the system clock changing unexpectedly, for example if an NTP update moves the clock backwards during a transaction.
