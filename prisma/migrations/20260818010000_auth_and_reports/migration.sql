CREATE TYPE "ReportStatus" AS ENUM ('PROCESSING', 'COMPLETE');

CREATE TABLE "accounts" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL, "provider_account_id" TEXT NOT NULL,
  "refresh_token" TEXT, "access_token" TEXT, "expires_at" INTEGER,
  "token_type" TEXT, "scope" TEXT, "id_token" TEXT, "session_state" TEXT,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL, "session_token" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL, CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" TEXT NOT NULL, "name" TEXT, "email" TEXT, "email_verified" TIMESTAMP(3),
  "image" TEXT, CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verification_tokens" (
  "identifier" TEXT NOT NULL, "token" TEXT NOT NULL, "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "reports" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'PROCESSING', "title" TEXT NOT NULL,
  "participant_a" TEXT NOT NULL, "participant_b" TEXT NOT NULL,
  "first_ts" INTEGER NOT NULL, "last_ts" INTEGER NOT NULL,
  "analysis" JSONB, "llm" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3), CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");
CREATE INDEX "reports_user_id_created_at_idx" ON "reports"("user_id", "created_at" DESC);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
