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

test("Release deletes a vacant channel", async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: 50,
    }).execute(client)

    const result = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(result).toMatchObject({
        resultType: "CHANNEL_RELEASED"
    })
    expect(channel).toBeUndefined()
})

test("Release marks a non-vacant channel as released", async () => {
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

    const channelBeforeRelease = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(channelBeforeRelease).toMatchObject({
        name: "alpha",
        released: false,
        current_size: 1,
        message_id: createResult.id.toString(),
        message_dequeue_at: "10",
        dequeue_next_at: "50",
    })

    const result = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(result).toMatchObject({
        resultType: "CHANNEL_RELEASED"
    })
    expect(channel).toMatchObject({
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
})

test("Release returns not found when the channel never existed", async () => {
    const result = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    expect(result).toMatchObject({
        resultType: "CHANNEL_NOT_FOUND"
    })
})

test("Release returns not found when the channel is already released", async () => {
    await new command.channel.Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2,
        maxSize: 5,
        releaseIntervalMs: 50,
    }).execute(client)

    await new command.message.Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: 10,
        content: Buffer.from("hello"),
    }).execute(client) as command.message.create.ResultMessageCreated

    await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    const result = await new command.channel.Release({
        schema: SCHEMA,
        channel: "alpha",
    }).execute(client)

    const channel = await client.query("SELECT * FROM test.channel").then(res => res.rows[0])

    expect(result).toMatchObject({
        resultType: "CHANNEL_NOT_FOUND"
    })
    expect(channel).toMatchObject({
        name: "alpha",
        released: true,
        current_size: 1,
    })
})
