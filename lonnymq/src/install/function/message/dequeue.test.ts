import * as util from "@src/util"
import { queryNextChannel, queryNextChannelMessage, queryNextLockedMessage } from "@src/install/function/message/dequeue"
import { Queue } from "@src/queue"
import { afterAll, beforeAll, beforeEach, test, expect } from "bun:test"
import { Client } from "pg"

const SCHEMA = "test"
const queue = new Queue({ schema: SCHEMA, lockMs: 30_000 })
let client: Client

const INDEX_SCAN_REGEX = /(Index Scan|Index Only Scan)/

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

test("queryNextLockedMessage uses index scans", async () => {
    await client.query("BEGIN")
    try {
        await client.query("SET LOCAL enable_seqscan = OFF")
        await client.query("SET LOCAL enable_bitmapscan = OFF")
        const query = util.sql.fragment`
            EXPLAIN (COSTS OFF)
            ${queryNextLockedMessage({ now: util.sql.fragment`0`, schema: SCHEMA })}
        `
        const result = await client.query(query.value)
        expect(result.rows.length).toBeGreaterThan(0)
        expect(result.rows[0]["QUERY PLAN"]).toMatch(INDEX_SCAN_REGEX)
        await client.query("COMMIT")
    } catch (err) {
        await client.query("ROLLBACK")
        throw err
    }
})

test("queryNextChannel uses index scans", async () => {
    await client.query("BEGIN")
    try {
        await client.query("SET LOCAL enable_seqscan = OFF")
        await client.query("SET LOCAL enable_bitmapscan = OFF")
        const query = util.sql.fragment`
            EXPLAIN (COSTS OFF)
            ${queryNextChannel({ schema: SCHEMA })}
        `
        const result = await client.query(query.value)
        expect(result.rows.length).toBeGreaterThan(0)
        expect(result.rows[0]["QUERY PLAN"]).toMatch(INDEX_SCAN_REGEX)
        await client.query("COMMIT")
    } catch (err) {
        await client.query("ROLLBACK")
        throw err
    }
})

test("queryNextChannelMessage uses index scans", async () => {
    await client.query("BEGIN")
    try {
        await client.query("SET LOCAL enable_seqscan = OFF")
        await client.query("SET LOCAL enable_bitmapscan = OFF")
        const query = util.sql.fragment`
            EXPLAIN (COSTS OFF)
            ${queryNextChannelMessage({ schema: SCHEMA, channel: util.sql.value(1) })}
        `
        const result = await client.query(query.value)
        expect(result.rows.length).toBeGreaterThan(0)
        expect(result.rows[0]["QUERY PLAN"]).toMatch(INDEX_SCAN_REGEX)
        await client.query("COMMIT")
    } catch (err) {
        await client.query("ROLLBACK")
        throw err
    }
})
