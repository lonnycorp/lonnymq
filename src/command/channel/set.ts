import * as constant from "@src/constant"
import * as util from "@src/util"
import * as database from "@src/database"

export class Set {

    readonly schema: string
    readonly channel: string
    readonly maxConcurrency: number
    readonly maxSize: number
    readonly releaseIntervalMs: number
    readonly createdAt: Date

    constructor(params: {
        schema: string,
        channel: string,
        maxConcurrency: number,
        maxSize: number,
        releaseIntervalMs: number
    }) {
        this.schema = params.schema
        this.channel = params.channel

        if (
            !Number.isInteger(params.maxConcurrency) ||
            params.maxConcurrency < 1 ||
            params.maxConcurrency > constant.INTEGER_MAX
        ) {
            throw new Error(`maxConcurrency must be an integer between 1 and ${constant.INTEGER_MAX}`)
        }

        if (
            !Number.isInteger(params.maxSize) ||
            params.maxSize < 1 ||
            params.maxSize > constant.INTEGER_MAX
        ) {
            throw new Error(`maxSize must be an integer between 1 and ${constant.INTEGER_MAX}`)
        }

        if (
            !Number.isInteger(params.releaseIntervalMs) ||
            params.releaseIntervalMs < 0 ||
            params.releaseIntervalMs > constant.INTEGER_MAX
        ) {
            throw new Error(`releaseIntervalMs must be an integer between 0 and ${constant.INTEGER_MAX}`)
        }

        this.maxConcurrency = params.maxConcurrency
        this.maxSize = params.maxSize
        this.releaseIntervalMs = params.releaseIntervalMs

        this.createdAt = new Date()
    }

    async execute(databaseClient: database.Client): Promise<void> {
        await databaseClient.query(util.sql.fragment`
            SELECT 1 FROM ${util.sql.ref(this.schema)}."channel_set"(
                $1,
                $2::INTEGER,
                $3::INTEGER,
                $4::INTEGER
            )
        `.value, [
            this.channel,
            this.maxConcurrency,
            this.maxSize,
            this.releaseIntervalMs
        ])
    }
}
