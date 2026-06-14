import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResultMessageNotAvailable = {
    result_code: constant.ResultCode.MESSAGE_NOT_AVAILABLE,
    content: null,
    state: null,
    metadata: null
}

type QueryResultMessageDequeued = {
    result_code: constant.ResultCode.MESSAGE_DEQUEUED,
    state: Buffer | null,
    content: Buffer,
    metadata: {
        id: string,
        is_unlocked: boolean,
        num_attempts: number
    }
}

type QueryResult =
    | QueryResultMessageNotAvailable
    | QueryResultMessageDequeued

export type ResultMessageDequeued = {
    resultType: "MESSAGE_DEQUEUED",
    id: bigint,
    isUnlocked: boolean,
    content: Buffer,
    state: Buffer | null,
    numAttempts: number,
}

export type ResultMessageNotAvailable = {
    resultType: "MESSAGE_NOT_AVAILABLE"
}

export type Result =
    | ResultMessageDequeued
    | ResultMessageNotAvailable

export class Dequeue {

    readonly schema: string
    readonly lockMs: number

    constructor(params: {
        schema: string,
        lockMs: number,
    }) {
        this.schema = params.schema
        this.lockMs = params.lockMs
    }

    async execute(databaseClient: database.Client) : Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT
                result_code,
                metadata,
                content,
                state
            FROM ${util.sql.ref(this.schema)}."message_dequeue"($1::BIGINT)
        `.value, [
            this.lockMs
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.MESSAGE_NOT_AVAILABLE) {
            return { resultType: "MESSAGE_NOT_AVAILABLE" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_DEQUEUED) {
            return {
                resultType: "MESSAGE_DEQUEUED",
                id: BigInt(result.metadata.id),
                isUnlocked: result.metadata.is_unlocked,
                content: result.content,
                state: result.state,
                numAttempts: result.metadata.num_attempts
            }
        } else {
            throw new Error("Unexpected dequeue result")
        }
    }

}
