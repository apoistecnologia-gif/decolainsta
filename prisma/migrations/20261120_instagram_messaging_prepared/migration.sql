-- PREVIEW-only migration: DO NOT APPLY until separately authorized.
-- No provider launch, no direct messages stored, no production DB change.
CREATE TABLE "InstagramMessagingConnection" (
  "id" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "instagramUserId" TEXT NOT NULL,
  "encryptedAccessToken" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramMessagingConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstagramMessagingConnection_instagramAccountId_key"
  ON "InstagramMessagingConnection"("instagramAccountId");
CREATE INDEX "InstagramMessagingConnection_instagramUserId_idx"
  ON "InstagramMessagingConnection"("instagramUserId");
ALTER TABLE "InstagramMessagingConnection"
  ADD CONSTRAINT "InstagramMessagingConnection_instagramAccountId_fkey"
  FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InstagramMessagingContact" (
  "id" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "senderIgsid" TEXT NOT NULL,
  "firstInboundAt" TIMESTAMP(3) NOT NULL,
  "lastInboundAt" TIMESTAMP(3) NOT NULL,
  "firstFollowConfirmedAt" TIMESTAMP(3),
  "lastRelationshipCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InstagramMessagingContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstagramMessagingContact_instagramAccountId_senderIgsid_key"
  ON "InstagramMessagingContact"("instagramAccountId","senderIgsid");
CREATE INDEX "InstagramMessagingContact_instagramAccountId_lastInboundAt_idx"
  ON "InstagramMessagingContact"("instagramAccountId","lastInboundAt");
ALTER TABLE "InstagramMessagingContact"
  ADD CONSTRAINT "InstagramMessagingContact_instagramAccountId_fkey"
  FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
