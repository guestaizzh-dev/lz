ALTER TABLE "MediaUpload" DROP CONSTRAINT "MediaUpload_purpose_check";
ALTER TABLE "MediaUpload" ADD CONSTRAINT "MediaUpload_purpose_check" CHECK (
  ("purpose" IN ('COURSE', 'HOME_HERO') AND "forumSectionId" IS NULL) OR
  ("purpose" = 'FORUM_MEDIA' AND "forumSectionId" IS NOT NULL AND "bytes" <= 268435456)
);
