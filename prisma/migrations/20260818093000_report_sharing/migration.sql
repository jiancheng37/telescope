ALTER TABLE "reports" ADD COLUMN "share_token" TEXT;
CREATE UNIQUE INDEX "reports_share_token_key" ON "reports"("share_token");
