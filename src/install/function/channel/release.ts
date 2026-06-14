import * as constant from "@src/constant"
import * as util from "@src/util"

export const release = (params : {
    schema: string,
}) => {
    return [
        util.sql.fragment`
            CREATE FUNCTION ${util.sql.ref(params.schema)}."channel_release" (
                p_text TEXT
            ) RETURNS TABLE (
                result_code INTEGER
            ) AS $$
            DECLARE
                v_channel RECORD;
            BEGIN
                SELECT
                    "channel"."id",
                    "channel"."current_size"
                FROM ${util.sql.ref(params.schema)}."channel"
                WHERE "name" = p_text
                AND NOT "released"
                FOR UPDATE
                INTO v_channel;

                IF v_channel."id" IS NULL THEN
                    RETURN QUERY SELECT
                        ${util.sql.value(constant.ResultCode.CHANNEL_NOT_FOUND)};
                    RETURN;
                END IF;

                IF v_channel."current_size" = 0 THEN
                    DELETE FROM ${util.sql.ref(params.schema)}."channel"
                    WHERE "id" = v_channel."id";
                ELSE
                    UPDATE ${util.sql.ref(params.schema)}."channel" SET
                        "released" = TRUE
                    WHERE "id" = v_channel."id";
                END IF;

                RETURN QUERY SELECT
                    ${util.sql.value(constant.ResultCode.CHANNEL_RELEASED)};
                RETURN;
            END;
            $$ LANGUAGE plpgsql;
        `
    ]
}
