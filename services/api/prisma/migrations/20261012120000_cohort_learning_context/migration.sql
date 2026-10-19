BEGIN;

ALTER TABLE "CourseCohort" ADD CONSTRAINT "CourseCohort_identity_key" UNIQUE (id,"courseId","releaseId");
ALTER TABLE "Lesson" ADD CONSTRAINT "Lesson_id_releaseId_key" UNIQUE (id,"releaseId");

CREATE TABLE "CohortRegistration" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL REFERENCES "User"(id),
  "cohortId" text NOT NULL,
  "courseId" text NOT NULL,
  "releaseId" text NOT NULL,
  source text NOT NULL DEFAULT 'COHORT_FREE' CHECK (source='COHORT_FREE'),
  "revokedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  "legacyEnrollmentSnapshot" jsonb,
  UNIQUE ("userId","cohortId"),
  UNIQUE (id,"userId","releaseId"),
  UNIQUE (id,"userId","courseId","releaseId"),
  FOREIGN KEY ("cohortId","courseId","releaseId") REFERENCES "CourseCohort"(id,"courseId","releaseId")
);
CREATE INDEX "CohortRegistration_userId_createdAt_id_idx" ON "CohortRegistration"("userId","createdAt",id);
CREATE INDEX "CohortRegistration_cohortId_revokedAt_idx" ON "CohortRegistration"("cohortId","revokedAt");

CREATE TABLE "CohortStudyProgress" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "registrationId" text NOT NULL,
  "userId" text NOT NULL,
  "releaseId" text NOT NULL,
  "lessonId" text NOT NULL,
  "positionSeconds" integer NOT NULL DEFAULT 0 CHECK ("positionSeconds">=0),
  "watchedSeconds" integer NOT NULL DEFAULT 0 CHECK ("watchedSeconds">=0),
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("registrationId","lessonId"),
  FOREIGN KEY ("registrationId","userId","releaseId") REFERENCES "CohortRegistration"(id,"userId","releaseId"),
  FOREIGN KEY ("lessonId","releaseId") REFERENCES "Lesson"(id,"releaseId")
);
CREATE INDEX "CohortStudyProgress_userId_updatedAt_idx" ON "CohortStudyProgress"("userId","updatedAt");

CREATE TABLE "CohortCertificate" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "registrationId" text NOT NULL UNIQUE,
  "userId" text NOT NULL,
  "courseId" text NOT NULL,
  "releaseId" text NOT NULL,
  "cohortTitle" text NOT NULL,
  "courseTitle" text NOT NULL,
  "lessonCount" integer NOT NULL CHECK ("lessonCount">0),
  "completedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("registrationId","userId","courseId","releaseId") REFERENCES "CohortRegistration"(id,"userId","courseId","releaseId")
);
ALTER TABLE "StudyEvent" ADD COLUMN "cohortRegistrationId" text REFERENCES "CohortRegistration"(id);

-- Preserve legacy free-cohort facts before releasing the ordinary-course unique slot.
-- BEGIN LEGACY CONVERSION
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Enrollment" WHERE "cohortId" IS NOT NULL AND (source<>'COHORT_FREE' OR "orderItemId" IS NOT NULL))
     OR EXISTS (SELECT 1 FROM "CourseVersionChoice" v JOIN "Enrollment" e ON e.id=v."enrollmentId" WHERE e."cohortId" IS NOT NULL)
  THEN RAISE EXCEPTION 'Legacy cohort has paid or version-choice facts; review before conversion'; END IF;
END $$;
INSERT INTO "CohortRegistration" (id,"userId","cohortId","courseId","releaseId",source,"revokedAt","createdAt","updatedAt",version,"legacyEnrollmentSnapshot")
SELECT e.id,e."userId",e."cohortId",e."courseId",e."releaseId",e.source,e."revokedAt",e."createdAt",e."updatedAt",e.version,to_jsonb(e)
FROM "Enrollment" e WHERE e."cohortId" IS NOT NULL;
INSERT INTO "CohortStudyProgress" (id,"registrationId","userId","releaseId","lessonId","positionSeconds","watchedSeconds","completedAt","createdAt","updatedAt")
SELECT p.id,e.id,p."userId",e."releaseId",p."lessonId",p."positionSeconds",p."watchedSeconds",p."completedAt",p."createdAt",p."updatedAt"
FROM "StudyProgress" p JOIN "Lesson" l ON l.id=p."lessonId" JOIN "Enrollment" e ON e."userId"=p."userId" AND e."releaseId"=l."releaseId" WHERE e."cohortId" IS NOT NULL;
INSERT INTO "CohortCertificate" (id,"registrationId","userId","courseId","releaseId","cohortTitle","courseTitle","lessonCount","completedAt","createdAt")
SELECT c.id,e.id,c."userId",c."courseId",c."releaseId",co.title,c."courseTitle",c."lessonCount",c."completedAt",c."createdAt"
FROM "CourseCertificate" c JOIN "Enrollment" e ON e."userId"=c."userId" AND e."releaseId"=c."releaseId" JOIN "CourseCohort" co ON co.id=e."cohortId";
UPDATE "StudyEvent" s SET "cohortRegistrationId"=e.id FROM "Enrollment" e,"Lesson" l WHERE e."cohortId" IS NOT NULL AND e."userId"=s."userId" AND l.id=s."lessonId" AND l."releaseId"=e."releaseId";
DELETE FROM "StudyProgress" p USING "Enrollment" e,"Lesson" l WHERE e."cohortId" IS NOT NULL AND e."userId"=p."userId" AND l.id=p."lessonId" AND l."releaseId"=e."releaseId";
DELETE FROM "CourseCertificate" c USING "Enrollment" e WHERE e."cohortId" IS NOT NULL AND e."userId"=c."userId" AND e."releaseId"=c."releaseId";
DELETE FROM "Enrollment" WHERE "cohortId" IS NOT NULL;
-- END LEGACY CONVERSION

ALTER TABLE "Enrollment" ADD CONSTRAINT "Enrollment_ordinary_context" CHECK ("cohortId" IS NULL);

CREATE FUNCTION protect_cohort_registration_identity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(NEW.id,NEW."userId",NEW."cohortId",NEW."courseId",NEW."releaseId",NEW.source,NEW."legacyEnrollmentSnapshot")
     IS DISTINCT FROM ROW(OLD.id,OLD."userId",OLD."cohortId",OLD."courseId",OLD."releaseId",OLD.source,OLD."legacyEnrollmentSnapshot")
  THEN RAISE EXCEPTION 'Cohort registration identity is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CohortRegistration_identity" BEFORE UPDATE ON "CohortRegistration" FOR EACH ROW EXECUTE FUNCTION protect_cohort_registration_identity();
COMMIT;
