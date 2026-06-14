import * as util from "@src/util"

export const set = (params : {
    schema: string,
}) => {
    return [
        util.sql.fragment`
            CREATE FUNCTION ${util.sql.ref(params.schema)}."channel_set" (
                p_text TEXT,
                p_max_concurrency INTEGER,
                p_max_size INTEGER,
                p_release_interval_ms INTEGER
            ) RETURNS VOID AS $$
            BEGIN
                INSERT INTO ${util.sql.ref(params.schema)}."channel" (
                    "name",
                    "max_concurrency",
                    "max_size",
                    "current_concurrency",
                    "current_size",
                    "release_interval_ms",
                    "released",
                    "dequeue_prev_at"
                ) VALUES (
                    p_text,
                    p_max_concurrency,
                    p_max_size,
                    0,
                    0,
                    p_release_interval_ms,
                    FALSE,
                    0
                ) ON CONFLICT ("name") WHERE NOT "released" DO UPDATE SET
                    "max_concurrency" = EXCLUDED."max_concurrency",
                    "max_size" = EXCLUDED."max_size",
                    "release_interval_ms" = EXCLUDED."release_interval_ms",
                    "released" = EXCLUDED."released",
                    "dequeue_next_at" = CASE
                        WHEN "channel"."message_id" IS NULL THEN NULL
                        ELSE GREATEST(
                            "channel"."message_dequeue_at",
                            "channel"."dequeue_prev_at" + EXCLUDED."release_interval_ms"
                        )
                    END;
            END;
            $$ LANGUAGE plpgsql;
        `
    ]
}
