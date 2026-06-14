import * as command from "@src/command"
import type * as database from "@src/database"

export class Message<T> {

    private readonly schema: string
    private readonly adaptor: database.Adaptor<T>

    readonly id : bigint
    readonly isUnlocked: boolean
    readonly content: Buffer
    readonly state: Buffer | null
    readonly numAttempts: number

    constructor(params: {
        schema: string,
        adaptor: database.Adaptor<T>
        id: bigint,
        isUnlocked: boolean,
        content: Buffer,
        state: Buffer | null,
        numAttempts: number,
    }) {
        this.schema = params.schema
        this.adaptor = params.adaptor
        this.id = params.id
        this.isUnlocked = params.isUnlocked
        this.content = params.content
        this.state = params.state
        this.numAttempts = params.numAttempts
    }

    async defer(params: {
        databaseClient: T,
        state? : Buffer,
        dequeueAt?: number
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)

        return new command.message.Defer({
            schema: this.schema,
            id: this.id,
            numAttempts: this.numAttempts,
            dequeueAt: params.dequeueAt ?? null,
            state: params.state ?? null,
        }).execute(adaptedClient)
    }

    async complete(params: {
        databaseClient: T,
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)
        return new command.message.Complete({
            schema: this.schema,
            numAttempts: this.numAttempts,
            id: this.id,
        }).execute(adaptedClient)
    }

    async heartbeat(params: {
        databaseClient: T,
        lockMs: number
    }) {
        const adaptedClient = this.adaptor(params.databaseClient)
        return new command.message.Heartbeat({
            schema: this.schema,
            id: this.id,
            numAttempts: this.numAttempts,
            lockMs: params.lockMs,
        }).execute(adaptedClient)
    }
}
