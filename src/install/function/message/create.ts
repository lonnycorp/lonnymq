import * as constant from "@src/constant"
import * as util from "@src/util"

export const create = (params : {
    schema: string,
    eventChannel: string | null,
}) => {
    return [
        util.sql.fragment`
                CREATE FUNCTION ${util.sql.ref(params.schema)}."message_create" (
                    p_channel TEXT,
                    p_content BYTEA,
                    p_dequeue_at BIGINT
                ) RETURNS TABLE (
                    result_code INTEGER,
                    metadata JSON
                ) AS $$
                DECLARE
                    v_now BIGINT;
                    v_dequeue_at BIGINT;
                    v_channel RECORD;
                    v_message RECORD;
                BEGIN
                    v_now := ${util.sql.ref(params.schema)}."epoch"();
                    v_dequeue_at := COALESCE(p_dequeue_at, v_now);

                    SELECT 
                        "channel"."id",
                        "channel"."current_concurrency",
                        "channel"."current_size",
                        "channel"."max_concurrency",
                        "channel"."max_size",
                        "channel"."release_interval_ms",
                        "channel"."dequeue_prev_at",
                        "channel"."message_id",
                        "channel"."message_dequeue_at"
                    FROM ${util.sql.ref(params.schema)}."channel"
                    WHERE "name" = p_channel
                    AND NOT "released"
                    FOR UPDATE
                    INTO v_channel;

                    IF v_channel."id" IS NULL THEN
                        RETURN QUERY SELECT
                            ${util.sql.value(constant.ResultCode.CHANNEL_NOT_FOUND)},
                            NULL::JSON;
                        RETURN;
                    END IF;

                    IF v_channel."current_size" >= v_channel."max_size" THEN
                        RETURN QUERY SELECT
                            ${util.sql.value(constant.ResultCode.MESSAGE_DROPPED)},
                            NULL::JSON;
                        RETURN;
                    END IF;

                    INSERT INTO ${util.sql.ref(params.schema)}."message" (
                        "channel_id",
                        "content",
                        "num_attempts",
                        "dequeue_at"
                    ) VALUES (
                        v_channel."id",
                        p_content,
                        0,
                        v_dequeue_at
                    ) RETURNING
                        "id"
                    INTO v_message;

                    IF 
                        v_channel."message_id" IS NULL OR
                        v_dequeue_at < v_channel."message_dequeue_at" OR
                        v_dequeue_at = v_channel."message_dequeue_at" AND v_message."id" < v_channel."message_id"
                    THEN
                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
                            "current_size" = v_channel."current_size" + 1,
                            "message_id" = v_message."id",
                            "message_dequeue_at" = v_dequeue_at,
                            "dequeue_next_at" = GREATEST(
                                v_channel."dequeue_prev_at" + v_channel."release_interval_ms",
                                v_dequeue_at
                            )
                        WHERE "id" = v_channel."id";
                    ELSE
                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
                            "current_size" = v_channel."current_size" + 1
                        WHERE "id" = v_channel."id";
                    END IF;

                    IF ${util.sql.value(params.eventChannel !== null)} THEN
                        PERFORM PG_NOTIFY(
                            ${util.sql.value(params.eventChannel)},
                            JSON_BUILD_OBJECT(
                                'type', ${util.sql.value(constant.ResultCode.MESSAGE_CREATED)},
                                'id', v_message."id"::TEXT,
                                'dequeue_at', v_dequeue_at
                            )::TEXT
                        );
                    END IF;

	                    RETURN QUERY SELECT
	                        ${util.sql.value(constant.ResultCode.MESSAGE_CREATED)},
	                        JSON_BUILD_OBJECT(
	                            'id', v_message."id"::TEXT
	                        );
                END;
                $$ LANGUAGE plpgsql;
        `
    ]
}
