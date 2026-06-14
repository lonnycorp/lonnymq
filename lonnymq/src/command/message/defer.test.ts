import * as command from "@src/command"
import { decode, type DecodeResult } from "@src/event"
import { Queue } from "@src/queue"
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { Client } from "pg"

const EVENT_CHANNEL = "EVENTS"
const SCHEMA = "test"
const queue = new Queue({ schema: SCHEMA, lockMs: 30_000 })
const events: DecodeResult[] = []
let client: Client

beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    await client.query(`LISTEN "${EVENT_CHANNEL}"`)
    client.on("notification", (msg) => {
        if (msg.channel === EVENT_CHANNEL && msg.payload !== undefined) {
            events.push(decode(msg.payload))
        }
    })
})

afterAll(async () => {
    await client.end()
})

beforeEach(async () => {
    events.length = 0
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    await client.query(`CREATE SCHEMA "${SCHEMA}"`)
    for (const install of queue.install({ eventChannel: EVENT_CHANNEL })) {
        await client.query(install)
    }
})

const setChannel = async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 3,
        maxSize: 5,
        releaseIntervalMs: 0,
    }).execute(client)
}

const createMessage = async (dequeueAt: number) => {
    return await new command.message.Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt,
        content: Buffer.from("hello"),
    }).execute(client) as command.message.create.ResultMessageCreated
}

const dequeueMessage = async () => {
    return await new command.message.Dequeue({
        schema: SCHEMA,
        lockMs: 30_000,
    }).execute(client) as command.message.dequeue.ResultMessageDequeued
}

test("Defer returns not found when the message does not exist", async () => {
    const result = await new command.message.Defer({
        schema: SCHEMA,
        id: 1n,
        numAttempts: 1,
        dequeueAt: 10,
        state: Buffer.from("state"),
    }).execute(client)

    expect(result).toMatchObject({
        resultType: "MESSAGE_NOT_FOUND"
    })
    expect(events).toHaveLength(0)
})

test("Defer returns state invalid when the message is not locked", async () => {
    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: createResult.id.toString(),
    })

    const result = await new command.message.Defer({
        schema: SCHEMA,
        id: createResult.id,
        numAttempts: 0,
        dequeueAt: 20,
        state: Buffer.from("state"),
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "STATE_INVALID"
    })
    expect(events).toHaveLength(0)

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: createResult.id.toString(),
        num_attempts: "0",
        dequeue_at: "10",
        unlock_at: null,
        state: null,
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 0,
        current_size: 1,
    })
})

test("Defer returns state invalid when the num attempts do not match", async () => {
    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: createResult.id.toString(),
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: createResult.id,
        numAttempts: 1,
    })

    const result = await new command.message.Defer({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts + 1,
        dequeueAt: 20,
        state: Buffer.from("state"),
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "STATE_INVALID"
    })
    expect(events).toHaveLength(0)

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: createResult.id.toString(),
        num_attempts: "1",
        dequeue_at: "10",
        state: null,
    })
    expect(message.unlock_at).not.toBeNull()

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 1,
        current_size: 1,
    })
})

test("Defer unlocks the message and emits an event with the supplied dequeueAt", async () => {
    const deferAt = Date.now() + 60_000

    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: createResult.id.toString(),
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: createResult.id,
        numAttempts: 1,
    })

    const result = await new command.message.Defer({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts,
        dequeueAt: deferAt,
        state: Buffer.from("state"),
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "MESSAGE_DEFERRED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_DEFERRED",
        id: dequeueResult.id.toString(),
        dequeueAt: deferAt,
    })

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: createResult.id.toString(),
        num_attempts: "1",
        dequeue_at: deferAt.toString(),
        unlock_at: null,
        state: Buffer.from("state"),
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 0,
        current_size: 1,
        message_id: createResult.id.toString(),
        message_dequeue_at: deferAt.toString(),
        dequeue_next_at: deferAt.toString(),
    })
})

test("Defer does not let a historical dequeueAt jump the channel queue", async () => {
    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: createResult.id.toString(),
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: createResult.id,
        numAttempts: 1,
    })

    const result = await new command.message.Defer({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts,
        dequeueAt: 1,
        state: null,
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "MESSAGE_DEFERRED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_DEFERRED",
        id: dequeueResult.id.toString(),
        dequeueAt: 1,
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 0,
        current_size: 1,
        message_id: createResult.id.toString(),
        message_dequeue_at: "1",
    })
    expect(channel.dequeue_next_at).toBe(channel.dequeue_prev_at)
    expect(Number(channel.dequeue_next_at)).toBeGreaterThan(1)
})
