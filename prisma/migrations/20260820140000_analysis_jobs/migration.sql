CREATE TYPE "AnalysisJobStatus" AS ENUM (
  'AWAITING_UPLOAD',
  'QUEUED',
  'PROCESSING',
  'COMPLETE',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "analysis_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "status" "AnalysisJobStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
  "storage_key" TEXT NOT NULL,
  "upload_bytes" INTEGER NOT NULL,
  "participant_a" TEXT NOT NULL,
  "participant_b" TEXT NOT NULL,
  "stage" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analysis_jobs_storage_key_key" ON "analysis_jobs"("storage_key");
CREATE INDEX "analysis_jobs_user_id_created_at_idx" ON "analysis_jobs"("user_id", "created_at" DESC);
CREATE INDEX "analysis_jobs_status_created_at_idx" ON "analysis_jobs"("status", "created_at");
CREATE INDEX "analysis_jobs_report_id_status_idx" ON "analysis_jobs"("report_id", "status");

ALTER TABLE "analysis_jobs"
ADD CONSTRAINT "analysis_jobs_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analysis_jobs"
ADD CONSTRAINT "analysis_jobs_report_id_fkey"
FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
