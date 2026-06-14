import * as command from "@src/command"
import * as install from "@src/install"
import * as module from "@src/queue/module"
import * as event from "@src/event"
import * as util from "@src/util"
import * as database from "@src/database"
import { Message } from "@src/queue/message"

export { Message } from "@src/queue/message"
export * as module from "@src/queue/module"

export type DequeueResult<T> =
    | { resultType: "MESSAGE_NOT_AVAILABLE" }
    | { resultType: "MESSAGE_DEQUEUED", message: Message<T> }

export type Params<T> = T extends database.Client
    ? { schema: string, adaptor?: database.Adaptor<T>, lockMs: number }
    : { schema: string, adaptor: database.Adaptor<T>, lockMs: number }

export class Queue<T = database.Client> {

    readonly schema: string
    readonly lockMs: number

    private readonly adaptor: database.Adaptor<T>

    constructor(params : Params<T>) {
        this.schema = params.schema
        this.lockMs = params.lockMs
        this.adaptor = params.adaptor
            ? params.adaptor
            : (x : database.Client) => x
    }

    async dequeue(params: {
        databaseClient: T
    }): Promise<DequeueResult<T>> {
        const dequeue = new command.message.Dequeue({
            schema: this.schema,
            lockMs: this.lockMs,
        })

        const adaptedClient = this.adaptor(params.databaseClient)
        const result = await dequeue.execute(adaptedClient)

        if (result.resultType === "MESSAGE_DEQUEUED") {
            return {
                resultType: "MESSAGE_DEQUEUED",
                message: new Message({
                    schema: this.schema,
                    adaptor: this.adaptor,
                    id: result.id,
                    isUnlocked: result.isUnlocked,
                    content: result.content,
                    state: result.state,
                    numAttempts: result.numAttempts,
                })
            }
        } else {
            return result
        }
    }

    channel(channel: string) {
        return new module.Channel({
            adaptor: this.adaptor,
            schema: this.schema,
            channel: channel
        })
    }

    install(params: {
        eventChannel?: string,
    } = {}) : string[] {
        return [
            install.table.channel,
            install.table.message,
            install.function.epoch,
            install.function.channel.set,
            install.function.channel.release,
            install.function.message.create,
            install.function.message.dequeue,
            install.function.message.complete,
            install.function.message.defer,
            install.function.message.heartbeat,
        ]
            .flatMap(install => install({
                schema: this.schema,
                eventChannel: params.eventChannel ?? null,
            })).map(sql => util.text.dedent(sql.value))
    }

    static decode(payload : string) {
        return event.decode(payload)
    }
}
