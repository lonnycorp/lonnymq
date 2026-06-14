import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResult =
    | { result_code: constant.ResultCode.CHANNEL_NOT_FOUND }
    | { result_code: constant.ResultCode.CHANNEL_RELEASED }

export type ResultChannelNotFound = {
    resultType: "CHANNEL_NOT_FOUND"
}

export type ResultChannelReleased = {
    resultType: "CHANNEL_RELEASED"
}

export type Result =
    | ResultChannelNotFound
    | ResultChannelReleased

export class Release {

    readonly schema: string
    readonly channel: string
    readonly createdAt: Date

    constructor(params: {
        schema: string,
        channel: string
    }) {
        this.schema = params.schema
        this.channel = params.channel
        this.createdAt = new Date()
    }

    async execute(databaseClient: database.Client): Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT * FROM ${util.sql.ref(this.schema)}."channel_release"(
                $1
            )
        `.value, [
            this.channel
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.CHANNEL_NOT_FOUND) {
            return { resultType: "CHANNEL_NOT_FOUND" }
        } else if (result.result_code === constant.ResultCode.CHANNEL_RELEASED) {
            return { resultType: "CHANNEL_RELEASED" }
        } else {
            result satisfies never
            throw new Error("Unexpected result")
        }
    }
}
