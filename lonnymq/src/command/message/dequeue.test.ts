import { Set } from "@src/command/channel"
import { Create, Defer, Dequeue, Complete, create } from "@src/command/message"
import { Queue } from "@src/queue"
import { sleep } from "bun"
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { Client } from "pg"

const SCHEMA = "test"
const queue = new Queue({ schema: SCHEMA, lockMs: 30_000 })
let client: Client

beforeAll(async () => {
    client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
})

afterAll(async () => {
    await client.end()
})

beforeEach(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    await client.query(`CREATE SCHEMA "${SCHEMA}"`)
    for (const sql of queue.install()) {
        await client.query(sql)
    }
})


test("Dequeue correctly increments channel", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2_147_483_647,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 50,
    }).execute(client)

    const messageCreate1Command = new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("hello")
    })

    await messageCreate1Command.execute(client)

    const messageCreate2Command = new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("hello")
    })

    const createResult = await messageCreate2Command.execute(client) as create.ResultMessageCreated

    const messageDequeueCommand = new Dequeue({ schema: SCHEMA, lockMs: 600 })

    const messageDequeueResult = await messageDequeueCommand.execute(client)
    expect(messageDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(channel).toMatchObject({
        name: "alpha",
        current_size: 2,
        message_id: createResult.id.toString(),
        dequeue_next_at: String(Number(channel.dequeue_prev_at) + 50)

    })
})

test("Dequeue handles messages in the correct order with correct metadata", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 1,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    const messageContents = Array.from({ length: 100 }, (_, i) => `message-${i}`)
    try {
        await client.query("BEGIN")
        for (const content of messageContents) {
            await new Create({
                schema: SCHEMA,
                channel: "alpha",
                dequeueAt: null,
                content: Buffer.from(content)
            }).execute(client)
        }

        await client.query("COMMIT")
    } catch (e) {
        await client.query("ROLLBACK")
        throw e
    }

    let counter = 0
    let previouslyNotAvailable = false

    while (counter < messageContents.length) {
        const result = await new Dequeue({ schema: SCHEMA, lockMs: 10 }).execute(client)
        if (result.resultType === "MESSAGE_NOT_AVAILABLE") {
            expect(previouslyNotAvailable).toBe(false)
            previouslyNotAvailable = true
            await sleep(20)
            continue
        }

        previouslyNotAvailable = false
        expect(result).toMatchObject({ content: Buffer.from(messageContents[counter]) })

        if (result.numAttempts === 1) {
            if (counter % 15 === 0) {
                continue
            } else if (counter % 10 === 0) {
                await new Defer({
                    schema: SCHEMA,
                    numAttempts: result.numAttempts,
                    dequeueAt: null,
                    state: null,
                    id: result.id
                }).execute(client)
            }
        }

        if (counter % 15 === 0) {
            expect(result.isUnlocked).toBe(true)
        }

        counter += 1
        await new Complete({
            schema: SCHEMA,
            id: result.id,
            numAttempts: result.numAttempts,
        }).execute(client)
    }
})

test("Dequeue correctly increments numAttempts after defer", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 1,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    await new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("test message")
    }).execute(client)

    const firstDequeueResult = await new Dequeue({ schema: SCHEMA, lockMs: 10 }).execute(client) as any
    expect(firstDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })
    expect(firstDequeueResult.numAttempts).toBe(1)

    await new Defer({
        schema: SCHEMA,
        numAttempts: firstDequeueResult.numAttempts,
        dequeueAt: null,
        state: null,
        id: firstDequeueResult.id
    }).execute(client)

    const secondDequeueResult = await new Dequeue({ schema: SCHEMA, lockMs: 10 }).execute(client) as any
    expect(secondDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })
    expect(secondDequeueResult.numAttempts).toBe(2)
})

test("Dequeue correctly sets isUnlocked", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 1,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    await new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("test message")
    }).execute(client)

    const firstDequeueResult = await new Dequeue({ schema: SCHEMA, lockMs: 0 }).execute(client) as any
    expect(firstDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })
    expect(firstDequeueResult.isUnlocked).toBe(false)

    const secondDequeueResult = await new Dequeue({ schema: SCHEMA, lockMs: 0 }).execute(client) as any
    expect(secondDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })
    expect(secondDequeueResult.isUnlocked).toBe(true)
})
