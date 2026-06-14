import * as constant from "@src/constant"
import * as util from "@src/util"

export const defer = (params : {
    schema: string,
    eventChannel: string | null,
}) => {
    return [
        util.sql.fragment`
                CREATE FUNCTION ${util.sql.ref(params.schema)}."message_defer" (
                    p_id BIGINT,
                    p_num_attempts BIGINT,
                    p_dequeue_at BIGINT,
                    p_state BYTEA
                )
                RETURNS TABLE (
                    result_code INTEGER
                ) AS $$
                DECLARE
                    v_now BIGINT;
                    v_channel RECORD;
                    v_message RECORD;
                    v_dequeue_at BIGINT;
                BEGIN
                    v_now := ${util.sql.ref(params.schema)}."epoch"();

                    SELECT
                        "message"."id",
                        "message"."channel_id",
                        "message"."num_attempts",
                        "message"."unlock_at"
                    FROM ${util.sql.ref(params.schema)}."message"
                    WHERE "id" = p_id
                    FOR UPDATE
                    INTO v_message;

                    IF v_message."id" IS NULL THEN
                        RETURN QUERY SELECT
                            ${util.sql.value(constant.ResultCode.MESSAGE_NOT_FOUND)};
                        RETURN;
                    ELSIF v_message."unlock_at" IS NULL OR v_message."num_attempts" <> p_num_attempts THEN
                        RETURN QUERY SELECT
                            ${util.sql.value(constant.ResultCode.MESSAGE_STATE_INVALID)};
                        RETURN;
                    END IF;

                    SELECT
                        "channel"."current_concurrency",
                        "channel"."release_interval_ms",
                        "channel"."message_id",
                        "channel"."message_dequeue_at",
                        "channel"."dequeue_prev_at"
                    FROM ${util.sql.ref(params.schema)}."channel"
                    WHERE "id" = v_message."channel_id"
                    FOR UPDATE
                    INTO v_channel;

                    v_dequeue_at := COALESCE(p_dequeue_at, v_now);

                    IF 
                        v_channel."message_id" IS NULL OR 
                        v_dequeue_at < v_channel."message_dequeue_at" OR
                        v_dequeue_at = v_channel."message_dequeue_at" AND v_message."id" < v_channel."message_id"
                    THEN
                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
                            "current_concurrency" = v_channel."current_concurrency" - 1,
                            "message_id" = v_message."id",
                            "message_dequeue_at" = v_dequeue_at,
                            "dequeue_next_at" = GREATEST(
                                v_channel."dequeue_prev_at" + v_channel."release_interval_ms",
                                v_dequeue_at
                            )
                        WHERE "id" = v_message."channel_id";
                    ELSE
                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
                            "current_concurrency" = v_channel."current_concurrency" - 1
                        WHERE "id" = v_message."channel_id";
                    END IF;

                    UPDATE ${util.sql.ref(params.schema)}."message" SET
                        "state" = p_state,
                        "unlock_at" = NULL,
                        "dequeue_at" = v_dequeue_at
                    WHERE "id" = p_id;

                    IF ${util.sql.value(params.eventChannel !== null)} THEN
                        PERFORM PG_NOTIFY(
                            ${util.sql.value(params.eventChannel)},
                            JSON_BUILD_OBJECT(
                                'type', ${util.sql.value(constant.ResultCode.MESSAGE_DEFERRED)},
                                'dequeue_at', v_dequeue_at,
                                'id', p_id::TEXT
                            )::TEXT
                        );
                    END IF;

                    RETURN QUERY SELECT
                        ${util.sql.value(constant.ResultCode.MESSAGE_DEFERRED)};
                    RETURN;
                END;
                $$ LANGUAGE plpgsql;
        `
    ]
}
