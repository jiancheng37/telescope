ALTER TABLE "reports"
ADD COLUMN "participant_set_key" TEXT NOT NULL DEFAULT 'direct';

-- Existing group reports were unique per Telegram group. Preserve each report,
-- and derive the selected participant set from its saved deterministic analysis.
UPDATE "reports"
SET "participant_set_key" = COALESCE(
  (
    SELECT '[' || string_agg(to_jsonb(participant->>'id')::TEXT, ',' ORDER BY participant->>'id') || ']'
    FROM jsonb_array_elements("reports"."analysis"->'participants') AS participant
    WHERE participant->>'id' IS NOT NULL
  ),
  '[]'
)
WHERE "kind" = 'GROUP';

DROP INDEX "reports_user_id_chat_id_key";
CREATE UNIQUE INDEX "reports_user_id_chat_id_participant_set_key_key"
ON "reports"("user_id", "chat_id", "participant_set_key");
