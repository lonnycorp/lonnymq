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

test("Complete deletes a released channel when completing its final message", async () => {
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

    const releaseResult = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    expect(releaseResult).toMatchObject({
        resultType: "CHANNEL_RELEASED"
    })

    const result = await new command.message.Complete({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts,
    }).execute(client)

    expect(result).toMatchObject({
        resultType: "MESSAGE_COMPLETED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_COMPLETED",
        id: dequeueResult.id.toString(),
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toBeUndefined()

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toBeUndefined()
})

test("Complete decrements released channel size and concurrency when messages remain", async () => {
    await setChannel()
    const firstCreateResult = await createMessage(10)
    expect(firstCreateResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: firstCreateResult.id.toString(),
    })

    const secondCreateResult = await createMessage(20)
    expect(secondCreateResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: secondCreateResult.id.toString(),
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: firstCreateResult.id,
        numAttempts: 1,
    })

    const releaseResult = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)
    expect(releaseResult).toMatchObject({
        resultType: "CHANNEL_RELEASED"
    })

    const result = await new command.message.Complete({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts,
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "MESSAGE_COMPLETED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_COMPLETED",
        id: dequeueResult.id.toString(),
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        released: true,
        max_concurrency: 3,
        max_size: 5,
        release_interval_ms: 0,
        current_concurrency: 0,
        current_size: 1,
        message_id: secondCreateResult.id.toString(),
        message_dequeue_at: "20",
    })
    expect(channel.dequeue_next_at).toBe(channel.dequeue_prev_at)
    expect(Number(channel.dequeue_next_at)).toBeGreaterThan(20)

    const completedMessage = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [firstCreateResult.id.toString()]
    ).then(res => res.rows[0])
    expect(completedMessage).toBeUndefined()

    const remainingMessage = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [secondCreateResult.id.toString()]
    ).then(res => res.rows[0])
    expect(remainingMessage).toMatchObject({
        id: secondCreateResult.id.toString(),
        unlock_at: null,
    })
})

test("Complete returns not found when the message does not exist", async () => {
    const result = await new command.message.Complete({
        schema: SCHEMA,
        id: 1n,
        numAttempts: 1,
    }).execute(client)

    expect(result).toMatchObject({
        resultType: "MESSAGE_NOT_FOUND"
    })
})

test("Complete returns state invalid when the message is not locked", async () => {
    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })

    const result = await new command.message.Complete({
        schema: SCHEMA,
        id: createResult.id,
        numAttempts: 0,
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "STATE_INVALID"
    })

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: createResult.id.toString(),
        num_attempts: "0",
        unlock_at: null,
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 0,
        current_size: 1,
    })
})

test("Complete returns state invalid when the num attempts do not match", async () => {
    await setChannel()
    const createResult = await createMessage(10)
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: createResult.id,
        numAttempts: 1,
    })

    const result = await new command.message.Complete({
        schema: SCHEMA,
        id: dequeueResult.id,
        numAttempts: dequeueResult.numAttempts + 1,
    }).execute(client)
    expect(result).toMatchObject({
        resultType: "STATE_INVALID"
    })

    const message = await client.query(
        "SELECT * FROM test.message WHERE id = $1",
        [createResult.id.toString()]
    ).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: createResult.id.toString(),
        num_attempts: "1",
    })
    expect(message.unlock_at).not.toBeNull()

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 1,
        current_size: 1,
    })
})
