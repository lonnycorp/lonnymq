import * as constant from "@src/constant"

type PayloadMessageCreated = {
    type: constant.ResultCode.MESSAGE_CREATED
    id: string,
    dequeue_at: string
}

type PayloadMessageCompleted = {
    type: constant.ResultCode.MESSAGE_COMPLETED,
    id: string,
}

type PayloadMessageDeferred = {
    type: constant.ResultCode.MESSAGE_DEFERRED,
    id: string,
    dequeue_at: string
}

type Payload =
    | PayloadMessageCreated
    | PayloadMessageCompleted
    | PayloadMessageDeferred

export type DecodeResultMessageCreated = {
    eventType: "MESSAGE_CREATED",
    id: string,
    dequeueAt: number
}

export type DecodeResultMessageCompleted = {
    eventType: "MESSAGE_COMPLETED",
    id: string,
}

export type DecodeResultMessageDeferred = {
    eventType: "MESSAGE_DEFERRED",
    id: string,
    dequeueAt: number
}

export type DecodeResult =
    | DecodeResultMessageCreated
    | DecodeResultMessageCompleted
    | DecodeResultMessageDeferred

export const decode = (payload : string) : DecodeResult => {
    const parsed = JSON.parse(payload) as Payload
    if (parsed.type === constant.ResultCode.MESSAGE_CREATED) {
        return {
            eventType: "MESSAGE_CREATED",
            id: parsed.id,
            dequeueAt: Number(parsed.dequeue_at),
        }
    } else if (parsed.type === constant.ResultCode.MESSAGE_COMPLETED) {
        return {
            eventType: "MESSAGE_COMPLETED",
            id: parsed.id,
        }
    } else if (parsed.type === constant.ResultCode.MESSAGE_DEFERRED) {
        return {
            eventType: "MESSAGE_DEFERRED",
            id: parsed.id,
            dequeueAt: Number(parsed.dequeue_at),
        }
    } else {
        parsed satisfies never
        throw new Error("Unknown event type")
    }
}
