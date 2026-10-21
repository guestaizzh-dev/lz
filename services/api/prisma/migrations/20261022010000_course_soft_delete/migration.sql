ALTER TABLE "Course" ADD COLUMN "deletedAt" timestamptz;
ALTER TABLE "Course" ADD CONSTRAINT "course_deleted_archived" CHECK ("deletedAt" IS NULL OR status = 'ARCHIVED');
