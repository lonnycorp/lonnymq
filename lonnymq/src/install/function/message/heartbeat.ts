import * as constant from "@src/constant"
import * as util from "@src/util"

export const heartbeat = (params : {
    schema: string,
    eventChannel: string | null,
}) => {
    return [
        util.sql.fragment`
                CREATE FUNCTION ${util.sql.ref(params.schema)}."message_heartbeat" (
                    p_id BIGINT,
                    p_num_attempts BIGINT,
                    p_lock_ms BIGINT
                )
                RETURNS TABLE (
                    result_code INTEGER
                ) AS $$
                DECLARE
                    v_now BIGINT;
                    v_message RECORD;
                BEGIN
                    v_now := ${util.sql.ref(params.schema)}."epoch"();

                    SELECT
                        "message"."id",
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

                    UPDATE ${util.sql.ref(params.schema)}."message" SET
                        "unlock_at" = GREATEST(
                            v_now + p_lock_ms,
                            v_message."unlock_at"
                        )
                    WHERE "id" = p_id;

                    RETURN QUERY SELECT
                        ${util.sql.value(constant.ResultCode.MESSAGE_HEARTBEATED)};
                    RETURN;
                END;
                $$ LANGUAGE plpgsql;
        `
    ]
}
