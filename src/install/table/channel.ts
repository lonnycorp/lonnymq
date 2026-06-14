import * as util from "@src/util"

export const channel = (params : {
    schema: string,
}) => {
    const dequeueIndex = [params.schema, "channel_dequeue_ix"].join("_")
    const nameIndex = [params.schema, "channel_name_ix"].join("_")
    return [
        util.sql.fragment`
            CREATE TABLE ${util.sql.ref(params.schema)}."channel" (
                "id" BIGSERIAL NOT NULL,
                "name" TEXT NOT NULL,
                "released" BOOLEAN NOT NULL,
                "max_concurrency" INTEGER NOT NULL,
                "max_size" INTEGER NOT NULL,
                "release_interval_ms" INTEGER NOT NULL,
                "current_size" INTEGER NOT NULL,
                "current_concurrency" INTEGER NOT NULL,
                "message_id" BIGINT,
                "message_dequeue_at" BIGINT,
                "dequeue_prev_at" BIGINT NOT NULL,
                "dequeue_next_at" BIGINT NULL,
                PRIMARY KEY ("id")
            );
        `,
        util.sql.fragment`
            CREATE UNIQUE INDEX ${util.sql.ref(nameIndex)}
            ON ${util.sql.ref(params.schema)}."channel" (
                "name"
            ) WHERE NOT "released";
        `,
        util.sql.fragment`
            CREATE INDEX ${util.sql.ref(dequeueIndex)}
            ON ${util.sql.ref(params.schema)}."channel" (
                "dequeue_next_at" ASC
            ) WHERE "message_id" IS NOT NULL
            AND "current_concurrency" < "max_concurrency";
        `
    ]
}
