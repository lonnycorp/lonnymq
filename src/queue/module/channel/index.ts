import * as command from "@src/command"
import * as constant from "@src/constant"
import type * as database from "@src/database"
import { Message } from "@src/queue/module/channel/message"

export { Message } from "@src/queue/module/channel/message"

export class Channel<T> {

    private readonly schema: string
    private readonly adaptor: database.Adaptor<T>
    private readonly channel: string

    readonly message: Message<T>

    constructor(params: {
        schema: string,
        adaptor: database.Adaptor<T>
        channel: string,
    }) {
        this.schema = params.schema
        this.adaptor = params.adaptor
        this.channel = params.channel

        this.message = new Message({
            schema: params.schema,
            adaptor: params.adaptor,
            channel: params.channel
        })
    }

    set(params : {
        databaseClient: T,
        maxConcurrency?: number | null,
        maxSize?: number | null,
        releaseIntervalMs?: number | null
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)
        return new command.channel.Set({
            schema: this.schema,
            channel: this.channel,
            maxConcurrency: params.maxConcurrency ?? constant.INTEGER_MAX,
            maxSize: params.maxSize ?? constant.INTEGER_MAX,
            releaseIntervalMs: params.releaseIntervalMs ?? 0
        }).execute(adaptedClient)
    }

    release(params: {
        databaseClient: T,
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)
        return new command.channel.Release({
            schema: this.schema,
            channel: this.channel
        }).execute(adaptedClient)
    }

}
