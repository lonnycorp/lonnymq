# LonnyMQ

A high-performance, multi-tenant PostgreSQL message queue implementation for Node.js/TypeScript.

## Features

- High throughput message processing
- Multi-tenant concurrency, capacity and throughput constraints
- Durable message processing with retries, recovery and custom back-off strategies
- Scheduled and periodic/repeating messages
- Message prioritisation
- Queue operations as part of existing database transactions
- Database client agnostic
- Granular events via PostgreSQL NOTIFY
- Zero dependencies

**Note:** Unlike other queue implementations, LonnyMQ provides direct access to queue methods rather than providing batteries-included Worker/Processor daemons.

### Benchmarking

With the following parameters:
 - Everything running in a single Bun instance
 - A locally hosted postgres database
 - 8 producers and 8 consumers using the core channel create/dequeue/complete flow

A message throughput of **~1,800** messages per second is observed.

## Quick Look

```typescript
import { Queue } from "@lonnycorp/lonnymq"
import { Pool } from "pg"

const databaseClient = new Pool({ connectionString: process.env.DATABASE_URL })
const queue = new Queue({ schema: "lonny", lockMs: 30_000 })

// Install the queue into your database.
for (const sql of queue.install()) {
    await databaseClient.query(sql)
}

const emails = queue.channel("emails")

// Create an explicit channel before adding messages to it.
await emails.set({
    databaseClient,
    maxConcurrency: 8,
    releaseIntervalMs: 100,
})

// Create a message on that channel.
await emails.message.create({
    databaseClient,
    content: Buffer.from(JSON.stringify({
        to: "ada@example.com",
        template: "welcome",
    })),
})

// Dequeue the next available message.
const result = await queue.dequeue({ databaseClient })

if (result.resultType === "MESSAGE_DEQUEUED") {
    const { message } = result

    try {
        await sendEmail(JSON.parse(message.content.toString()))

        // Complete removes the message permanently.
        await message.complete({ databaseClient })
    } catch {
        const backoffMs = Math.min(60_000, 2 ** message.numAttempts * 1_000)

        // Defer re-schedules the message for a future attempt.
        await message.defer({
            databaseClient,
            dequeueAt: Date.now() + backoffMs,
        })
    }
}
```

## Setup & Installation

LonnyMQ can be installed from npm:

```bash
npm install @lonnycorp/lonnymq
```

Once the package is installed, the queue needs to be "installed" to a postgres schema. The requisite SQL for this can be generated via: 

```typescript
const queue = new Queue({ schema: "lonny", lockMs: 30_000 })

const sqlCommands = queue.install({
    eventChannel: "lonnymq-events"
})

for (const sql of sqlCommands) {
    await databaseClient.query(sql)
}
```

_Optional_ parameters can be passed in to alter default queue behaviour/semantics. If an `eventChannel` is provided, LonnyMQ will publish queue events to the channel provided via `NOTIFY`.


## Channels

Channels provide LonnyMQ's multi-tenancy support. They can be considered lightweight sub-queues that are read from in round-robin fashion. There is no performance penalty for using large numbers of channels, so they can be assigned on a highly granular basis (e.g., per-user) to ensure work is scheduled fairly.

Channels are explicit. A message can only be created for a channel that already exists and has not been released. Create or update a channel with `set`:

```typescript
await queue
    .channel("my-channel")
    .set({ 
        databaseClient,
        maxConcurrency: 1,
        releaseIntervalMs: 1000,
        maxSize: 1_000
    })

// Release the channel:
await queue
    .channel("my-channel")
    .release({ databaseClient })
```

The channel constraints are optional:

- `maxConcurrency` limits how many messages from the channel may be processed at the same time.
- `maxSize` limits how many live messages the channel may contain. Once full, new messages for that channel are dropped.
- `releaseIntervalMs` enforces a minimum delay between fresh dequeues from the channel, which is useful for implementing rate limiting.

Releasing a channel prevents new messages from being created for that channel name. If the channel is empty it is deleted immediately; otherwise its constraints are removed and it is deleted once its remaining messages are completed.

## Message Creation

You can add a message to an existing channel using the channel's `message.create` function:

```typescript
await queue
    .channel("my-channel")
    .set({ databaseClient })
```

```typescript
const result = await queue
    .channel("my-channel")
    .message
    .create({
        databaseClient,
        content: Buffer.from("Hello, world")
    })
```

Creation returns a result because messages are not always accepted. If the channel does not exist, the result will be `CHANNEL_NOT_FOUND`; if the channel is at `maxSize`, the result will be `MESSAGE_DROPPED`; otherwise it will be `MESSAGE_CREATED`.

By default, created messages are immediately available for processing. To delay availability you can pass a `dequeueAt` unix timestamp (in milliseconds) that specifies the earliest time the message may be dequeued.

```typescript
await queue
    .channel("my-channel")
    .message
    .create({
        databaseClient,
        content: Buffer.from("Hello, world"),
        dequeueAt: Date.now() + 5_000 // 5s in the future
    })
```

N.B. `dequeueAt` is compared against the _database_ clock.

### Message Prioritization

LonnyMQ doesn't use an explicit message priority field for performance reasons. In short, there is no way to find the highest priority message that is also available for dequeue for a particular channel without some amount of linear scanning in the worst case vs. simply using an index lookup. 

However, once a channel is eligible to release work, messages within that channel are dequeued in order of their `dequeueAt` values (oldest first). Thus, by overloading the semantics of the `dequeueAt` field and using _historic_ unix timestamps (i.e. `0`, `1`, `2`, etc.) - messages can trivially be prioritised within a channel.

Of course, this means a message cannot be both high priority and scheduled to run in the future. In practice, that is usually a reasonable trade-off: a high-priority message that should not run yet is a slightly contradictory thing, and not a serious use case for LonnyMQ.

N.B. there is no way to _globally_ prioritise a message. Historic `dequeueAt` values only affect ordering inside the message's own channel; they do not let that channel skip round-robin fairness, concurrency limits or rate limits.

## Message Processing

Messages can be fetched for processing by calling `dequeue` on the `Queue`. This locks the message for the queue's configured `lockMs` duration. Once processing is complete, messages must be finalized via **completion** or **deferral**.

```typescript
const dequeueResult = await queue.dequeue({ databaseClient })

if (dequeueResult.resultType === "MESSAGE_DEQUEUED") {
    const { message } = dequeueResult
    console.log(`Processing message: ${message.id}`)
    console.log(`Content: ${message.content.toString()}`)
    console.log(`State: ${message.state?.toString()}`)
    
    try {
        // Process the message...
        await processMessage(message.content)
        
        // Complete on success
        await message.complete({ databaseClient })
    } catch (error) {
        if (message.numAttempts >= 5) {
            // Too many retries, complete permanently
            await message.complete({ databaseClient })
        } else {
            // Defer for retry with exponential backoff and updated state
            const backoffMs = Math.pow(2, message.numAttempts) * 1_000
            await message.defer({ 
                databaseClient,
                dequeueAt: Date.now() + backoffMs,
                state: Buffer.from(JSON.stringify({ 
                    error: error.message,
                    lastAttempt: new Date().toISOString()
                }))
            })
        }
    }
} else {
    console.log("No messages available")
}
```

The `lockMs` parameter on the `Queue` constructor specifies how long a message will remain exclusively locked after being dequeued. While locked, the message is **not available** for subsequent `dequeue()` calls, preventing duplicate processing. If your process crashes or takes longer than expected, the message will automatically become available for dequeue again after the lock expires.

When a message is deferred it becomes immediately available for re-processing unless you supply a `dequeueAt` timestamp.

Deferral can also persist a new `state` buffer on the message. This is useful for durable, piecewise processing: a worker can do part of the work, save intermediate progress in `state`, and defer the message for a later attempt. If the process crashes after the defer commits, the next dequeue sees the saved state and can resume from that point instead of starting again from scratch.

**Note:** The above shows just one processing pattern (defer on failure with retry limits). You have complete flexibility in how you handle message processing - you might complete messages immediately after processing, defer them unconditionally, or implement different retry strategies based on error types, attempts, and state.

### Extending Message Locks with Heartbeats

For messages that take a long time to process, setting a large initial lock is far from ideal. A locked message occupies one of its channel's concurrency slots until it is completed, deferred, or unlocked by timeout. If a worker crashes shortly after dequeue, that orphaned lock can reduce throughput for the whole channel until the lock expires. To mitigate this, you can set a short initial lock time that can be periodically renewed during message processing via a heartbeat:

```typescript
const dequeueResult = await queue.dequeue({ databaseClient })

if (dequeueResult.resultType === "MESSAGE_DEQUEUED") {
    const { message } = dequeueResult

    const heartbeatInterval = setInterval(() => {
        message
            .heartbeat({
                databaseClient,
                lockMs: 30_000
            })
            .catch((error) => {
                clearInterval(heartbeatInterval)
                throw error
            })
    }, 20_000)
    
    try {
        await processLongRunningTask(message.content)
        await message.complete({ databaseClient })
    } catch (error) {
        await message.defer({ 
            databaseClient, 
            dequeueAt: Date.now() + 60_000 
        })
    } finally {
        clearInterval(heartbeatInterval)
    }
}
```

### Graceful Shutdowns and Message Recovery

If your program ends unexpectedly, messages it has dequeued but not yet completed or deferred may be left locked, reducing channel throughput until their locks expire. To mitigate this, track in-flight messages and handle planned shutdowns such as `SIGINT`/`SIGTERM` explicitly: complete work only if it definitely finished, otherwise defer it so another worker can retry. Hard failures such as OOMs, segfaults and power cuts cannot run cleanup logic, so lock expiry remains the final recovery mechanism.

## Events

Using PostgreSQL `NOTIFY`, we can receive a granular stream of queue events:

  1. `MESSAGE_CREATED`
  2. `MESSAGE_DEFERRED`
  3. `MESSAGE_COMPLETED`

```typescript
const install = queue.install({ eventChannel: "EVENTS"})
```

### Improving on Polling

The simplest approach for processing messages is to call `dequeue` in a loop, backing off with a sleep when no messages are available. The downside of this approach is that we lose reactivity as we increase the polling timeout interval.

```typescript
// Basic polling approach
while (true) {
    const result = await queue.dequeue({ databaseClient })
    
    if (result.resultType === "MESSAGE_NOT_AVAILABLE") {
        await sleep(5_000) 
        continue
    }
    
    // Process message...
    await processMessage(result.message)
    await result.message.complete({ databaseClient })
}
```

To improve reactivity, use events to complement polling. By listening for `MESSAGE_CREATED` and `MESSAGE_DEFERRED` events and tracking their `dequeueAt` values, you can wake early when new work is likely to be available while keeping a slower polling loop as a safety net:

```typescript
// LISTEN/NOTIFY only works with a single connection - not on a connection pool.
const client = await databaseClient.connect()
await client.query(`LISTEN "EVENTS"`)

let nextWakeTime = Date.now()

client.on("notification", (msg) => {
    if (msg.channel === "EVENTS") {
        const event = Queue.decode(msg.payload as string)
        if (event.eventType === "MESSAGE_CREATED" || event.eventType === "MESSAGE_DEFERRED") {
            nextWakeTime = Math.min(nextWakeTime, event.dequeueAt)
        }
    }
})
```

## Deadlocks

If all queue actions are isolated to their own transaction, there is zero risk of deadlocks occurring. That being said, it is *possible* to safely bulk-perform the following actions within a single transaction if we ensure they are performed in a consistent ordering with respect to the target channel:

- Message create
- Channel set
- Channel release

Beyond the actions specified above, it is **unsafe** to bulk-perform any of the remaining actions within a single transaction. Each of these actions should be isolated within their **own** transaction:

- Message dequeue
- Message defer
- Message complete
- Message heartbeat

## Database Clients

LonnyMQ is designed to be database client agnostic, requiring only a minimal interface that most PostgreSQL clients already implement. Your database client must provide a single `query` method with this signature:

```typescript
interface DatabaseClient {
    query(sql: string, params: Array<unknown>): Promise<{
        rows: Array<Record<string, unknown>>
    }>
}
```

### Database Client Adapters

For database clients that don't match the expected interface exactly, LonnyMQ provides an adapter system to improve the developer experience. You can provide an adapter function when creating a Queue:

```typescript
import { Queue } from "@lonnycorp/lonnymq"

const queue = new Queue<NonCompliantDatabaseClient>({ 
    schema: "lonny",
    lockMs: 30_000,
    adaptor: (client : NonCompliantDatabaseClient) => ({
        query: async (sql, params) => {
            // Adapt the client's interface to match DatabaseClient
            const result = await client.executeQuery(sql, params)
            return { rows: result.data }
        }
    })
})
```
