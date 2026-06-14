import * as constant from "@src/constant"
import * as util from "@src/util"

export const queryNextLockedMessage = (params : {
    schema: string,
	now: util.sql.Node,
}) => util.sql.fragment`
    SELECT
        "message"."id",
        "message"."state",
        "message"."content",
        "message"."channel_id",
        "message"."unlock_at",
        "message"."num_attempts"
    FROM ${util.sql.ref(params.schema)}."message"
    WHERE "unlock_at" IS NOT NULL
    AND "unlock_at" <= ${params.now}
    ORDER BY "unlock_at" ASC
`

export const queryNextChannel = (params : {
    schema: string
}) => util.sql.fragment`
    SELECT
        "channel"."id",
        "channel"."release_interval_ms",
        "channel"."message_id",
        "channel"."dequeue_next_at",
        "channel"."dequeue_prev_at",
        "channel"."current_concurrency"
    FROM ${util.sql.ref(params.schema)}."channel"
    WHERE "message_id" IS NOT NULL
    AND "current_concurrency" < "max_concurrency"
    ORDER BY "dequeue_next_at" ASC
`

export const queryNextChannelMessage = (params : {
    schema: string,
    channel: util.sql.Node
}) => util.sql.fragment`
    SELECT
        "message"."id",
        "message"."dequeue_at"
    FROM ${util.sql.ref(params.schema)}."message"
    WHERE "unlock_at" IS NULL
    AND "channel_id" = ${params.channel}
    ORDER BY "dequeue_at" ASC, "id" ASC
`

export const dequeue = (params : {
    schema: string
}) => {
    const nextLockedMessage = queryNextLockedMessage({
        now: util.sql.fragment`v_now`,
        schema: params.schema,
    })

    const nextChannelMessage = queryNextChannelMessage({
        channel: util.sql.fragment`v_channel."id"`,
        schema: params.schema,
    })

    const nextChannel = queryNextChannel({
        schema: params.schema,
    })

    return [
        util.sql.fragment`
                CREATE FUNCTION ${util.sql.ref(params.schema)}."message_dequeue" (
                    p_lock_ms BIGINT
                )
                RETURNS TABLE (
                    result_code INTEGER,
                    content BYTEA,
                    state BYTEA,
                    metadata JSON
                ) AS $$
	                DECLARE
	                    v_now BIGINT;
	                    v_channel RECORD;
	                    v_message_locked RECORD;
	                    v_message_dequeue RECORD;
	                    v_message_next RECORD;
                BEGIN
                    v_now := ${util.sql.ref(params.schema)}."epoch"();

                    ${nextLockedMessage}
                    FOR UPDATE
                    SKIP LOCKED
                    LIMIT 1
                    INTO v_message_locked;

                    IF v_message_locked."id" IS NOT NULL THEN
                        UPDATE ${util.sql.ref(params.schema)}."message" SET
                            "num_attempts" = v_message_locked."num_attempts" + 1,
                            "unlock_at" = v_now + p_lock_ms 
                        WHERE "id" = v_message_locked."id";

                        RETURN QUERY SELECT 
                            ${util.sql.value(constant.ResultCode.MESSAGE_DEQUEUED)},
                            v_message_locked.content,
                            v_message_locked.state,
                            JSON_BUILD_OBJECT(
                                'id', v_message_locked."id",
                                'is_unlocked', TRUE,
                                'num_attempts', v_message_locked."num_attempts" + 1
                            );
                        RETURN;
                    END IF;

                    ${nextChannel}
                    FOR UPDATE
	                    SKIP LOCKED
	                    LIMIT 1
	                    INTO v_channel;

	                    IF v_channel."id" IS NULL OR v_channel."dequeue_next_at" > v_now THEN
	                        RETURN QUERY SELECT
	                            ${util.sql.value(constant.ResultCode.MESSAGE_NOT_AVAILABLE)},
	                            NULL::BYTEA,
	                            NULL::BYTEA,
	                            NULL::JSON;
                        RETURN;
                    END IF;

                    SELECT
                        "message"."id",
                        "message"."channel_id",
                        "message"."content",
                        "message"."num_attempts",
	                        "message"."state"
	                    FROM ${util.sql.ref(params.schema)}."message"
	                    WHERE "id" = v_channel."message_id"
	                    INTO v_message_dequeue;

                    UPDATE ${util.sql.ref(params.schema)}."message" SET
                        "num_attempts" = v_message_dequeue."num_attempts" + 1,
                        "unlock_at" = v_now + p_lock_ms
                    WHERE "id" = v_message_dequeue."id";

                    ${nextChannelMessage}
                    LIMIT 1
	                    INTO v_message_next;

	                    IF v_message_next."id" IS NULL THEN
	                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
	                            "current_concurrency" = v_channel."current_concurrency" + 1,
	                            "dequeue_prev_at" = v_now,
	                            "message_id" = NULL
	                        WHERE "id" = v_channel."id";
	                    ELSE
	                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
	                            "current_concurrency" = v_channel."current_concurrency" + 1,
	                            "message_id" = v_message_next."id",
	                            "message_dequeue_at" = v_message_next."dequeue_at",
	                            "dequeue_prev_at" = v_now,
	                            "dequeue_next_at" = GREATEST(
	                                v_message_next."dequeue_at",
	                                v_now + v_channel."release_interval_ms"
	                            )
	                        WHERE "id" = v_channel."id";
	                    END IF;

                    RETURN QUERY SELECT
                        ${util.sql.value(constant.ResultCode.MESSAGE_DEQUEUED)},
                        v_message_dequeue."content",
                        v_message_dequeue."state",
                        JSON_BUILD_OBJECT(
                            'id', v_message_dequeue."id"::TEXT,
                            'is_unlocked', FALSE,
                            'num_attempts', v_message_dequeue."num_attempts" + 1
                        );
                    RETURN;
                END;
                $$ LANGUAGE plpgsql;
        `
    ]
}
