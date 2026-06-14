import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResult =
    | { result_code: constant.ResultCode.MESSAGE_NOT_FOUND}
    | { result_code: constant.ResultCode.MESSAGE_STATE_INVALID }
    | { result_code: constant.ResultCode.MESSAGE_DEFERRED }

export type ResultMessageNotFound = {
    resultType: "MESSAGE_NOT_FOUND"
}

export type ResultStateInvalid = {
    resultType: "STATE_INVALID"
}

export type ResultMessageDeferred = {
    resultType: "MESSAGE_DEFERRED"
}

export type Result =
    | ResultMessageNotFound
    | ResultStateInvalid
    | ResultMessageDeferred

export class Defer {

    readonly schema: string
    readonly id: bigint
    readonly numAttempts: number
    readonly state: Buffer | null
    readonly dequeueAt: number | null

    constructor(params: {
        schema: string,
        id: bigint,
        numAttempts: number,
        state: Buffer | null
        dequeueAt: number | null
    }) {
        this.schema = params.schema
        this.numAttempts = params.numAttempts
        this.id = params.id
        this.state = params.state
        this.dequeueAt = params.dequeueAt
    }

    async execute(databaseClient: database.Client): Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT * FROM ${util.sql.ref(this.schema)}."message_defer"(
                $1::BIGINT,
                $2::BIGINT,
                $3::BIGINT,
                $4
            )
        `.value, [
            this.id.toString(),
            this.numAttempts,
            this.dequeueAt,
            this.state
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.MESSAGE_NOT_FOUND) {
            return { resultType: "MESSAGE_NOT_FOUND" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_STATE_INVALID) {
            return { resultType: "STATE_INVALID" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_DEFERRED) {
            return { resultType: "MESSAGE_DEFERRED" }
        } else {
            result satisfies never
            throw new Error("Unexpected result")
        }
    }
}
