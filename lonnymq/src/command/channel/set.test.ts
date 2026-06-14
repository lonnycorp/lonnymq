import * as command from "@src/command"
import { Queue } from "@src/queue"
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
    for (const install of queue.install()) {
        await client.query(install)
    }
})

test("Set rejects invalid concurrency", () => {
    expect(() => new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 0,
        maxSize: 5,
        releaseIntervalMs: 50,
    })).toThrow("maxConcurrency must be an integer between 1 and 2147483647")
})

test("Set rejects invalid size", () => {
    expect(() => new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 0,
        releaseIntervalMs: 50,
    })).toThrow("maxSize must be an integer between 1 and 2147483647")
})

test("Set rejects invalid release interval", () => {
    expect(() => new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: -1,
    })).toThrow("releaseIntervalMs must be an integer between 0 and 2147483647")
})

test("Set creates a channel", async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: 50,
    }).execute(client)

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(channel).toMatchObject({
        name: "alpha",
        released: false,
        max_concurrency: 2,
        max_size: 5,
        release_interval_ms: 50,
        current_concurrency: 0,
        current_size: 0,
        dequeue_prev_at: "0",
    })
    expect(channel.id).toBeDefined()
})

test("Set updates an existing channel", async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: 50,
    }).execute(client)

    const channelBeforeUpdate = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 3,
        maxSize: 8,
        releaseIntervalMs: 75,
    }).execute(client)

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(channel).toMatchObject({
        id: channelBeforeUpdate.id,
        name: "alpha",
        released: false,
        max_concurrency: 3,
        max_size: 8,
        release_interval_ms: 75,
        current_concurrency: 0,
        current_size: 0,
        dequeue_prev_at: "0",
    })
})

test("Set creates a new channel when a released channel has the same name", async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: 50,
    }).execute(client)

    const createResult = await new command.message.Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: 10,
        content: Buffer.from("hello"),
    }).execute(client) as command.message.create.ResultMessageCreated

    await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 4,
        maxSize: 9,
        releaseIntervalMs: 75,
    }).execute(client)

    const channels = await client.query("SELECT * FROM test.channel ORDER BY id ASC").then(res => res.rows)

    expect(channels).toHaveLength(2)
    expect(channels[0]).toMatchObject({
        name: "alpha",
        released: true,
        max_concurrency: 2,
        max_size: 5,
        release_interval_ms: 50,
        current_size: 1,
        message_id: createResult.id.toString(),
        message_dequeue_at: "10",
        dequeue_next_at: "50",
    })
    expect(channels[1]).toMatchObject({
        name: "alpha",
        released: false,
        max_concurrency: 4,
        max_size: 9,
        release_interval_ms: 75,
        current_concurrency: 0,
        current_size: 0,
        dequeue_prev_at: "0",
    })
    expect(channels[1].id).not.toBe(channels[0].id)
})
