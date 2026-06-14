import * as util from "@src/util"
import { describe, expect, it } from "bun:test"

describe("sql", () => {

    const testCases : [util.sql.Node, string ][] = [
        [util.sql.raw("\"FOO\""), "\"FOO\""],
        [util.sql.ref("FOO"), "\"FOO\""],
        [util.sql.ref("'FOO'"), "\"'FOO'\""],
        [util.sql.ref("\"FOO\""), "\"\"\"FOO\"\"\""],
        [util.sql.value(123), "123"],
        [util.sql.value("123"), "'123'"],
        [util.sql.value(null), "NULL"],
    ]

    for (const [input, expected] of testCases) {
        it(`${input.nodeType}:${input.value} is expected to be ${expected}`, () => {
            expect(util.sql.fragment`${input}`.value).toBe(expected)
        })
    }

})
