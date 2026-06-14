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

const setChannel = async (params: {
    maxConcurrency?: number | null,
    maxSize?: number | null,
    releaseIntervalMs?: number | null,
} = {}) => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: params.maxConcurrency ?? 3,
        maxSize: params.maxSize ?? 5,
        releaseIntervalMs: params.releaseIntervalMs ?? 0,
    }).execute(client)
}

const createMessage = async (params: {
    channel?: string,
    content?: Buffer,
    dequeueAt?: number | null,
} = {}) => {
    return await new command.message.Create({
        schema: SCHEMA,
        channel: params.channel ?? "alpha",
        content: params.content ?? Buffer.from("hello"),
        dequeueAt: params.dequeueAt ?? 10,
    }).execute(client)
}

const dequeueMessage = async () => {
    return await new command.message.Dequeue({
        schema: SCHEMA,
        lockMs: 30_000,
    }).execute(client) as command.message.dequeue.ResultMessageDequeued
}

test("Create persists a message in the DB", async () => {
    await setChannel()

    const result = await createMessage({
        content: Buffer.from("hello"),
        dequeueAt: 100,
    }) as command.message.create.ResultMessageCreated

    expect(result).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: result.id.toString(),
        dequeueAt: 100,
    })

    const message = await client.query(`
        SELECT
            "message"."id",
            "message"."content",
            "message"."num_attempts",
            "message"."dequeue_at",
            "message"."unlock_at",
            "channel"."name" AS "channel"
        FROM test.message
        INNER JOIN test.channel
        ON "channel"."id" = "message"."channel_id"
    `).then(res => res.rows[0])
    expect(message).toMatchObject({
        id: result.id.toString(),
        channel: "alpha",
        content: Buffer.from("hello"),
        num_attempts: "0",
        dequeue_at: "100",
        unlock_at: null,
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        released: false,
        current_concurrency: 0,
        current_size: 1,
        message_id: result.id.toString(),
        message_dequeue_at: "100",
        dequeue_next_at: "100",
    })
})

test("Create returns channel not found when the channel does not exist", async () => {
    const result = await createMessage({
        channel: "alpha",
    })
    expect(result).toMatchObject({
        resultType: "CHANNEL_NOT_FOUND"
    })

    const messages = await client.query("SELECT * FROM test.message").then(res => res.rows)
    expect(messages).toHaveLength(0)
    expect(events).toHaveLength(0)
})

test("Create returns channel not found when the channel has been released", async () => {
    await setChannel()

    const createResult = await createMessage() as command.message.create.ResultMessageCreated
    expect(createResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: createResult.id.toString(),
    })

    const releaseResult = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)
    expect(releaseResult).toMatchObject({
        resultType: "CHANNEL_RELEASED"
    })

    const result = await createMessage()
    expect(result).toMatchObject({
        resultType: "CHANNEL_NOT_FOUND"
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        released: true,
        current_size: 1,
    })

    const messages = await client.query("SELECT * FROM test.message").then(res => res.rows)
    expect(messages).toHaveLength(1)
    expect(events).toHaveLength(0)
})

test("Create drops messages when the channel is full", async () => {
    await setChannel({ maxSize: 2 })

    const firstResult = await createMessage({
        content: Buffer.from("first"),
        dequeueAt: 10,
    }) as command.message.create.ResultMessageCreated
    expect(firstResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: firstResult.id.toString(),
        dequeueAt: 10,
    })

    const secondResult = await createMessage({
        content: Buffer.from("second"),
        dequeueAt: 20,
    }) as command.message.create.ResultMessageCreated
    expect(secondResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: secondResult.id.toString(),
        dequeueAt: 20,
    })

    const thirdResult = await createMessage({
        content: Buffer.from("third"),
        dequeueAt: 30,
    })
    expect(thirdResult).toMatchObject({
        resultType: "MESSAGE_DROPPED"
    })
    expect(events).toHaveLength(0)

    const messages = await client.query(`
        SELECT
            "id",
            "content",
            "dequeue_at"
        FROM test.message
        ORDER BY "id" ASC
    `).then(res => res.rows)
    expect(messages).toMatchObject([
        {
            id: firstResult.id.toString(),
            content: Buffer.from("first"),
            dequeue_at: "10",
        },
        {
            id: secondResult.id.toString(),
            content: Buffer.from("second"),
            dequeue_at: "20",
        },
    ])
})

test("Create updates the channel when preempting a lower priority message", async () => {
    await setChannel()

    const firstResult = await createMessage({
        content: Buffer.from("first"),
        dequeueAt: 10,
    }) as command.message.create.ResultMessageCreated
    expect(firstResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: firstResult.id.toString(),
        dequeueAt: 10,
    })

    const firstChannel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(firstChannel).toMatchObject({
        name: "alpha",
        current_size: 1,
        message_id: firstResult.id.toString(),
        message_dequeue_at: "10",
        dequeue_next_at: "10",
    })

    const secondResult = await createMessage({
        content: Buffer.from("second"),
        dequeueAt: 5,
    }) as command.message.create.ResultMessageCreated
    expect(secondResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: secondResult.id.toString(),
        dequeueAt: 5,
    })

    const secondChannel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(secondChannel).toMatchObject({
        name: "alpha",
        current_size: 2,
        message_id: secondResult.id.toString(),
        message_dequeue_at: "5",
        dequeue_next_at: "5",
    })

    const messages = await client.query(`
        SELECT
            "message"."id",
            "message"."content",
            "message"."dequeue_at",
            "channel"."name" AS "channel"
        FROM test.message
        INNER JOIN test.channel
        ON "channel"."id" = "message"."channel_id"
        ORDER BY "message"."dequeue_at" ASC, "message"."id" ASC
    `).then(res => res.rows)
    expect(messages).toMatchObject([
        {
            id: secondResult.id.toString(),
            channel: "alpha",
            content: Buffer.from("second"),
            dequeue_at: "5",
        },
        {
            id: firstResult.id.toString(),
            channel: "alpha",
            content: Buffer.from("first"),
            dequeue_at: "10",
        },
    ])
})

test("Create does not let a historical dequeueAt jump the channel queue", async () => {
    await setChannel()

    const firstResult = await createMessage({
        content: Buffer.from("first"),
        dequeueAt: 10,
    }) as command.message.create.ResultMessageCreated
    expect(firstResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: firstResult.id.toString(),
        dequeueAt: 10,
    })

    const dequeueResult = await dequeueMessage()
    expect(dequeueResult).toMatchObject({
        resultType: "MESSAGE_DEQUEUED",
        id: firstResult.id,
        numAttempts: 1,
    })

    const secondResult = await createMessage({
        content: Buffer.from("second"),
        dequeueAt: 1,
    }) as command.message.create.ResultMessageCreated
    expect(secondResult).toMatchObject({
        resultType: "MESSAGE_CREATED"
    })
    expect(events.shift()).toMatchObject({
        eventType: "MESSAGE_CREATED",
        id: secondResult.id.toString(),
        dequeueAt: 1,
    })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])
    expect(channel).toMatchObject({
        name: "alpha",
        current_concurrency: 1,
        current_size: 2,
        message_id: secondResult.id.toString(),
        message_dequeue_at: "1",
    })
    expect(channel.dequeue_next_at).toBe(channel.dequeue_prev_at)
    expect(Number(channel.dequeue_next_at)).toBeGreaterThan(1)
})
