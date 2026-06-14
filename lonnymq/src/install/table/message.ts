import * as util from "@src/util"

export const message = (params : {
    schema: string,
}) => {
    return [
        util.sql.fragment`
            CREATE TABLE ${util.sql.ref(params.schema)}."message" (
                "id" BIGSERIAL NOT NULL,
                "channel_id" BIGINT NOT NULL,
                "content" BYTEA NOT NULL,
                "state" BYTEA,
                "num_attempts" BIGINT NOT NULL,
                "dequeue_at" BIGINT NOT NULL,
                "unlock_at" BIGINT,
                PRIMARY KEY ("id")
            );
        `,

        util.sql.fragment`
            CREATE INDEX "message_dequeue_ix"
            ON ${util.sql.ref(params.schema)}."message" (
                "channel_id",
                "dequeue_at" ASC,
                "id" ASC
            ) WHERE "unlock_at" IS NULL;
        `,

        util.sql.fragment`
            CREATE INDEX "message_locked_dequeue_ix"
            ON ${util.sql.ref(params.schema)}."message" (
                "unlock_at" ASC
            ) WHERE "unlock_at" IS NOT NULL;
        `
    ]
}
