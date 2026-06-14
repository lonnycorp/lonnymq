import { Set } from "@src/command/channel"
import { Create, Dequeue, Heartbeat, create } from "@src/command/message"
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
    for (const migration of queue.install()) {
        await client.query(migration)
    }
})

test("Heartbeat keeps bumping the unlock_at", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2_147_483_647,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    await new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("hello")
    }).execute(client)

    const messageDequeueCommand = new Dequeue({ schema: SCHEMA, lockMs: 50 })

    const messageDequeueResult = await messageDequeueCommand.execute(client)
    expect(messageDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })

    await sleep(80)

    const messageDequeue2Result = await messageDequeueCommand.execute(client) as any
    expect(messageDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })

    await sleep(80)

    const messageHeartbeatResult = await new Heartbeat({
        schema: SCHEMA,
        id: messageDequeue2Result.id,
        numAttempts: messageDequeue2Result.numAttempts,
        lockMs: 50,
    }).execute(client)
    expect(messageHeartbeatResult).toMatchObject({ resultType: "MESSAGE_HEARTBEATED" })

    const messageDequeue3Result = await messageDequeueCommand.execute(client)
    expect(messageDequeue3Result).toMatchObject({ resultType: "MESSAGE_NOT_AVAILABLE" })
})

test("Heartbeat fails on invalid numAttempts", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2_147_483_647,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    await new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("hello")
    }).execute(client)

    const messageDequeueCommand = new Dequeue({ schema: SCHEMA, lockMs: 50 })
    const messageDequeueResult = await messageDequeueCommand.execute(client) as any
    expect(messageDequeueResult).toMatchObject({ resultType: "MESSAGE_DEQUEUED" })

    const messageHeartbeatResult = await new Heartbeat({
        schema: SCHEMA,
        id: messageDequeueResult.id,
        numAttempts: 0,
        lockMs: 50,
    }).execute(client)

    expect(messageHeartbeatResult).toMatchObject({ resultType: "MESSAGE_STATE_INVALID" })
})

test("Heartbeat fails when not locked", async () => {
    await new Set({
        schema: SCHEMA,
        channel: "alpha",
        maxConcurrency: 2_147_483_647,
        maxSize: 2_147_483_647,
        releaseIntervalMs: 0,
    }).execute(client)

    const messageCreateCommand = new Create({
        schema: SCHEMA,
        channel: "alpha",
        dequeueAt: null,
        content: Buffer.from("hello")
    })
    const result = await messageCreateCommand.execute(client) as create.ResultMessageCreated

    const messageHeartbeatResult = await new Heartbeat({
        schema: SCHEMA,
        id: result.id,
        numAttempts: 0,
        lockMs: 50,
    }).execute(client)

    expect(messageHeartbeatResult).toMatchObject({ resultType: "MESSAGE_STATE_INVALID" })
})
