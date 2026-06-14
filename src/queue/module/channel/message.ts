import type * as database from "@src/database"
import * as command from "@src/command"

export class Message<T> {

    private readonly schema: string
    private readonly channel: string
    private readonly adaptor: database.Adaptor<T>

    constructor(params: {
        schema: string,
        adaptor: database.Adaptor<T>
        channel: string,
    }) {
        this.schema = params.schema
        this.adaptor = params.adaptor
        this.channel = params.channel
    }

    async create(params : {
        databaseClient: T,
        content: Buffer,
        dequeueAt?: number
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)

        const create = new command.message.Create({
            schema: this.schema,
            channel: this.channel,
            content: params.content,
            dequeueAt: params.dequeueAt ?? null,
        })

        return await create.execute(adaptedClient)
    }
}
