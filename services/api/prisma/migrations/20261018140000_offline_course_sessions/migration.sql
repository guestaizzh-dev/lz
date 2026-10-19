ALTER TABLE "CourseChapter" ADD COLUMN "eventSessionId" text REFERENCES "EventSession"(id);
ALTER TABLE "Lesson" ADD CONSTRAINT offline_lesson_session_fk FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"(id);
ALTER TABLE "EventRegistration" ADD COLUMN "courseReleaseId" text REFERENCES "CourseRelease"(id);
ALTER TABLE "StudyEvent" ADD COLUMN "offlineRegistrationId" text REFERENCES "EventRegistration"(id);
ALTER TABLE "StudyEvent" ADD CONSTRAINT single_study_context CHECK(num_nonnulls("cohortRegistrationId","offlineRegistrationId")<=1);
CREATE TABLE "OfflineCourseSession" (
 "sessionId" text PRIMARY KEY REFERENCES "EventSession"(id),"courseId" text NOT NULL REFERENCES "Course"(id),"createdAt" timestamptz NOT NULL DEFAULT now(),"actorId" text NOT NULL REFERENCES "User"(id)
);
CREATE INDEX "OfflineCourseSession_courseId_idx" ON "OfflineCourseSession"("courseId");
CREATE FUNCTION offline_registration_release() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session text; binding "OfflineCourseSession"; release text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."courseReleaseId" IS DISTINCT FROM OLD."courseReleaseId" THEN RAISE EXCEPTION 'Original onsite registration edition is immutable'; END IF;
  RETURN NEW;
 END IF;
 SELECT "sessionId" INTO session FROM "EventTicketType" WHERE id=NEW."ticketTypeId";
 SELECT * INTO binding FROM "OfflineCourseSession" WHERE "sessionId"=session;
 IF binding."courseId" IS NOT NULL THEN
  SELECT c."publishedReleaseId" INTO release FROM "Course" c JOIN "CourseRelease" r ON r.id=c."publishedReleaseId" JOIN "Teacher" t ON t.id=c."teacherId" WHERE c.id=binding."courseId" AND c.status='PUBLISHED' AND t.status='PUBLISHED' AND r."withdrawnAt" IS NULL AND EXISTS(SELECT 1 FROM "Lesson" WHERE "releaseId"=r.id AND format='OFFLINE' AND "eventSessionId"=session);
  IF release IS NULL OR NEW.quantity<>1 OR NEW."courseReleaseId" IS NOT NULL AND NEW."courseReleaseId"<>release THEN RAISE EXCEPTION 'Onsite registration requires an available frozen course edition and one learner'; END IF;
  NEW."courseReleaseId":=release;
 ELSIF NEW."courseReleaseId" IS NOT NULL THEN RAISE EXCEPTION 'Onsite course edition must originate from its actual session';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER offline_registration_release BEFORE INSERT OR UPDATE ON "EventRegistration" FOR EACH ROW EXECUTE FUNCTION offline_registration_release();
CREATE FUNCTION offline_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published onsite session ownership cannot be replaced or deleted'; END $$;
CREATE TRIGGER offline_binding_immutable BEFORE UPDATE OR DELETE ON "OfflineCourseSession" FOR EACH ROW EXECUTE FUNCTION offline_binding_immutable();
CREATE TABLE "OfflineStudyProgress" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"registrationId" text NOT NULL REFERENCES "EventRegistration"(id),"userId" text NOT NULL REFERENCES "User"(id),"releaseId" text NOT NULL REFERENCES "CourseRelease"(id),"lessonId" text NOT NULL REFERENCES "Lesson"(id),
 "positionSeconds" integer NOT NULL DEFAULT 0 CHECK("positionSeconds">=0),"watchedSeconds" integer NOT NULL DEFAULT 0 CHECK("watchedSeconds">=0),"completedAt" timestamptz,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),"lastEventAt" timestamptz,
 UNIQUE("registrationId","lessonId")
);
CREATE INDEX "OfflineStudyProgress_userId_updatedAt_idx" ON "OfflineStudyProgress"("userId","updatedAt");
CREATE TABLE "OfflineCourseCertificate" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"registrationId" text NOT NULL UNIQUE REFERENCES "EventRegistration"(id),"userId" text NOT NULL REFERENCES "User"(id),"courseId" text NOT NULL REFERENCES "Course"(id),"releaseId" text NOT NULL REFERENCES "CourseRelease"(id),"courseTitle" text NOT NULL,"lessonCount" integer NOT NULL CHECK("lessonCount">0),"completedAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now(),"sourceSnapshot" jsonb NOT NULL
);
CREATE FUNCTION validate_offline_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM "EventRegistration" r WHERE r.id=NEW."registrationId" AND r."userId"=NEW."userId" AND r."courseReleaseId"=NEW."releaseId") THEN RAISE EXCEPTION 'Onsite study must match original learner and course edition'; END IF;
 IF TG_TABLE_NAME='OfflineStudyProgress' THEN
  IF NOT EXISTS(SELECT 1 FROM "Lesson" WHERE id=NEW."lessonId" AND "releaseId"=NEW."releaseId") THEN RAISE EXCEPTION 'Onsite lesson must belong to original edition'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "CourseRelease" WHERE id=NEW."releaseId" AND "courseId"=NEW."courseId") THEN RAISE EXCEPTION 'Onsite certificate must match original course'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER offline_study_source BEFORE INSERT OR UPDATE ON "OfflineStudyProgress" FOR EACH ROW EXECUTE FUNCTION validate_offline_study();
CREATE TRIGGER offline_certificate_source BEFORE INSERT ON "OfflineCourseCertificate" FOR EACH ROW EXECUTE FUNCTION validate_offline_study();
CREATE INDEX offline_registration_owner ON "EventRegistration"("userId","courseReleaseId","createdAt");
