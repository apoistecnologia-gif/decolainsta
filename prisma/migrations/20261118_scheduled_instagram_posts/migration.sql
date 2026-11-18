-- ONLY the new scheduling queue table. Apply with a reviewed migration and a database backup.
-- Existing DecolaInsta tables are intentionally untouched.
CREATE TABLE "ScheduledInstagramPost" (
  "id" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "caption" TEXT NOT NULL DEFAULT '',
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "startedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "publishedMediaId" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledInstagramPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledInstagramPost_status_scheduledFor_idx"
  ON "ScheduledInstagramPost"("status", "scheduledFor");
CREATE INDEX "ScheduledInstagramPost_instagramAccountId_createdAt_idx"
  ON "ScheduledInstagramPost"("instagramAccountId", "createdAt");
ALTER TABLE "ScheduledInstagramPost"
  ADD CONSTRAINT "ScheduledInstagramPost_instagramAccountId_fkey"
  FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
