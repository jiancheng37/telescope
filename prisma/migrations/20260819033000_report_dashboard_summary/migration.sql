ALTER TABLE "reports"
ADD COLUMN "message_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "has_ai_insights" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the lightweight list fields from existing report payloads once, so
-- dashboard reads never need to retrieve or deserialize those JSONB columns.
UPDATE "reports"
SET
  "message_count" = COALESCE(("analysis" #>> '{volume,total}')::INTEGER, 0),
  "has_ai_insights" = "llm" IS NOT NULL;
