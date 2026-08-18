ALTER TABLE "reports" ADD COLUMN "chat_id" TEXT;

-- Give the newest existing report for each user/chat its stable identity. Older
-- duplicates stay untouched rather than being deleted during a schema migration.
WITH ranked AS (
  SELECT
    "id",
    "analysis" #>> '{chat,id}' AS "telegram_chat_id",
    ROW_NUMBER() OVER (
      PARTITION BY "user_id", "analysis" #>> '{chat,id}'
      ORDER BY "created_at" DESC
    ) AS "position"
  FROM "reports"
  WHERE "analysis" #>> '{chat,id}' IS NOT NULL
)
UPDATE "reports"
SET "chat_id" = ranked."telegram_chat_id"
FROM ranked
WHERE "reports"."id" = ranked."id" AND ranked."position" = 1;

CREATE UNIQUE INDEX "reports_user_id_chat_id_key" ON "reports"("user_id", "chat_id");
