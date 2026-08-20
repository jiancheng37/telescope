-- AlterTable
ALTER TABLE "reports" ADD COLUMN "share_messages_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "reports_share_messages_token_key" ON "reports"("share_messages_token");
