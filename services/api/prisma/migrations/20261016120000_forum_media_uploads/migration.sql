ALTER TABLE "MediaUpload" ADD COLUMN "purpose" text NOT NULL DEFAULT 'COURSE',
  ADD COLUMN "forumSectionId" text REFERENCES "ForumSection"(id) ON DELETE RESTRICT,
  ADD CONSTRAINT "MediaUpload_purpose_check" CHECK (
    ("purpose" = 'COURSE' AND "forumSectionId" IS NULL) OR
    ("purpose" = 'FORUM_MEDIA' AND "forumSectionId" IS NOT NULL AND "bytes" <= 268435456)
  );
CREATE INDEX "MediaUpload_purpose_expiresAt_idx" ON "MediaUpload"("purpose", "expiresAt");
CREATE UNIQUE INDEX "AttachmentBinding_forum_media_asset_idx" ON "AttachmentBinding"("assetId") WHERE "purpose" = 'FORUM_MEDIA';
