import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResult =
    | { result_code: constant.ResultCode.MESSAGE_NOT_FOUND}
    | { result_code: constant.ResultCode.MESSAGE_STATE_INVALID }
    | { result_code: constant.ResultCode.MESSAGE_COMPLETED }

export type ResultMessageNotFound = {
    resultType: "MESSAGE_NOT_FOUND"
}

export type ResultStateInvalid = {
    resultType: "STATE_INVALID"
}

export type ResultMessageCompleted = {
    resultType: "MESSAGE_COMPLETED"
}

export type Result =
    | ResultMessageNotFound
    | ResultStateInvalid
    | ResultMessageCompleted

export class Complete {

    readonly schema: string
    readonly id: bigint
    readonly numAttempts: number

    constructor(params: {
        schema: string,
        numAttempts: number,
        id: bigint,
    }) {
        this.schema = params.schema
        this.id = params.id
        this.numAttempts = params.numAttempts
    }

    async execute(databaseClient: database.Client): Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT * FROM ${util.sql.ref(this.schema)}."message_complete"(
                $1::BIGINT,
                $2::BIGINT
            )
        `.value, [
            this.id.toString(),
            this.numAttempts
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.MESSAGE_NOT_FOUND) {
            return { resultType: "MESSAGE_NOT_FOUND" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_STATE_INVALID) {
            return { resultType: "STATE_INVALID" }
        } else if (result.result_code === constant.ResultCode.MESSAGE_COMPLETED) {
            return { resultType: "MESSAGE_COMPLETED" }
        } else {
            result satisfies never
            throw new Error("Unexpected result")
        }
    }

}
