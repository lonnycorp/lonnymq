import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

type QueryResultMessageCreated = {
    result_code: constant.ResultCode.MESSAGE_CREATED,
    metadata: { id: string }
}

type QueryResultMessageDropped = {
    result_code: constant.ResultCode.MESSAGE_DROPPED,
    metadata: null
}

type QueryResultChannelNotFound = {
    result_code: constant.ResultCode.CHANNEL_NOT_FOUND,
    metadata: null
}

type QueryResult =
    | QueryResultMessageCreated
    | QueryResultMessageDropped
    | QueryResultChannelNotFound

export type ResultMessageCreated = {
    resultType: "MESSAGE_CREATED",
    id: bigint
}

export type ResultMessageDropped = {
    resultType: "MESSAGE_DROPPED"
}

export type ResultChannelNotFound = {
    resultType: "CHANNEL_NOT_FOUND"
}

export type Result =
    | ResultMessageCreated
    | ResultMessageDropped
    | ResultChannelNotFound

export class Create {

    readonly schema: string
    readonly channel: string
    readonly content: Buffer
    readonly dequeueAt: number | null

    constructor(params: {
        schema: string,
        channel: string,
        content: Buffer,
        dequeueAt: number | null
    }) {
        this.schema = params.schema
        this.channel = params.channel
        this.content = params.content
        this.dequeueAt = params.dequeueAt
    }

    async execute(databaseClient: database.Client): Promise<Result> {
        const result = await databaseClient.query(util.sql.fragment`
            SELECT 
                result_code, 
                metadata 
            FROM ${util.sql.ref(this.schema)}."message_create"(
                $1, 
                $2,
                $3::BIGINT
            )
        `.value, [
            this.channel,
            this.content,
            this.dequeueAt
        ]).then(res => res.rows[0] as QueryResult)

        if (result.result_code === constant.ResultCode.MESSAGE_CREATED) {
            return {
                resultType: "MESSAGE_CREATED",
                id: BigInt(result.metadata.id),
            }
        } else if (result.result_code === constant.ResultCode.MESSAGE_DROPPED) {
            return {
                resultType: "MESSAGE_DROPPED"
            }
        } else if (result.result_code === constant.ResultCode.CHANNEL_NOT_FOUND) {
            return {
                resultType: "CHANNEL_NOT_FOUND"
            }
        } else {
            result satisfies never
            throw new Error("Unexpected result code")
        }
    }
}
