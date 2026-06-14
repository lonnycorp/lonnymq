import * as constant from "@src/constant"
import * as util from "@src/util"

export const complete = (params : {
    schema: string,
    eventChannel: string | null,
}) => {
    return [
        util.sql.fragment`
                CREATE FUNCTION ${util.sql.ref(params.schema)}."message_complete" (
                    p_id BIGINT,
                    p_num_attempts BIGINT
                )
                RETURNS TABLE (
                    result_code INTEGER
                ) AS $$
                DECLARE
                    v_channel RECORD;
                    v_message RECORD;
                BEGIN
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
                        "channel"."id",
                        "channel"."released",
                        "channel"."current_size",
                        "channel"."current_concurrency"
                    FROM ${util.sql.ref(params.schema)}."channel"
                    WHERE "id" = v_message."channel_id"
                    FOR UPDATE
                    INTO v_channel;

                    IF v_channel."released" AND v_channel."current_size" = 1 THEN
                        DELETE FROM ${util.sql.ref(params.schema)}."channel"
                        WHERE "id" = v_channel."id";
                    ELSE
                        UPDATE ${util.sql.ref(params.schema)}."channel" SET
                            "current_concurrency" = v_channel."current_concurrency" - 1,
                            "current_size" = v_channel."current_size" - 1
                        WHERE "id" = v_channel."id";
                    END IF;

                    IF ${util.sql.value(params.eventChannel !== null)} THEN
                        PERFORM PG_NOTIFY(
                            ${util.sql.value(params.eventChannel)},
                            JSON_BUILD_OBJECT(
                                'type', ${util.sql.value(constant.ResultCode.MESSAGE_COMPLETED)},
                                'id', p_id::TEXT
                            )::TEXT
                        );
                    END IF;

                    DELETE FROM ${util.sql.ref(params.schema)}."message"
                    WHERE "id" = p_id;

                    RETURN QUERY SELECT
                        ${util.sql.value(constant.ResultCode.MESSAGE_COMPLETED)};
                    RETURN;
                END;
                $$ LANGUAGE plpgsql;
        `
    ]
}
