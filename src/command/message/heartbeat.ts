import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResult =
    | { result_code: constant.ResultCode.MESSAGE_NOT_FOUND}
    | { result_code: constant.ResultCode.MESSAGE_STATE_INVALID }
    | { result_code: constant.ResultCode.MESSAGE_HEARTBEATED }

export type ResultMessageNotFound = {
    resultType: "MESSAGE_NOT_FOUND"
}

export type ResultStateInvalid = {
    resultType: "MESSAGE_STATE_INVALID"
}

export type ResultMessageHeartbeated = {
    resultType: "MESSAGE_HEARTBEATED"
}

export type Result =
    | ResultMessageNotFound
    | ResultStateInvalid
    | ResultMessageHeartbeated

export class Heartbeat {

    readonly schema: string
    readonly id: bigint
    readonly numAttempts: number
    readonly lockMs: number

    constructor(params: {
        schema: string,
        id: bigint,
        numAttempts: number,
        lockMs: number,
    }) {
        this.schema = params.schema
        this.numAttempts = params.numAttempts
        this.id = params.id
        this.lockMs = params.lockMs
    }

    async execute(databaseClient: database.Client): Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT * FROM ${util.sql.ref(this.schema)}."message_heartbeat"(
                $1::BIGINT,
                $2::BIGINT,
                $3::BIGINT
            )
        `.value, [
            this.id.toString(),
            this.numAttempts,
            this.lockMs
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.MESSAGE_NOT_FOUND) {
            return { resultType: "MESSAGE_NOT_FOUND" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_STATE_INVALID) {
            return { resultType: "MESSAGE_STATE_INVALID" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_HEARTBEATED) {
            return { resultType: "MESSAGE_HEARTBEATED" }
        } else {
            result satisfies never
            throw new Error("Unexpected result")
        }
    }
}
