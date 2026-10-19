BEGIN;
ALTER TABLE "CourseCohort" ADD COLUMN "scheduleFrozenAt" timestamptz;
CREATE TABLE "CohortLessonSchedule" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cohortId" text NOT NULL,
  "courseId" text NOT NULL,
  "releaseId" text NOT NULL,
  "lessonId" text NOT NULL,
  "opensOnDay" integer NOT NULL DEFAULT 1 CHECK ("opensOnDay" BETWEEN 1 AND 3660),
  UNIQUE ("cohortId","lessonId"),
  FOREIGN KEY ("cohortId","courseId","releaseId") REFERENCES "CourseCohort"(id,"courseId","releaseId") ON DELETE CASCADE,
  FOREIGN KEY ("lessonId","releaseId") REFERENCES "Lesson"(id,"releaseId")
);
-- Existing learners retain opening-day access; never impose a new delay on historical cohorts.
-- BEGIN LEGACY SCHEDULE
INSERT INTO "CohortLessonSchedule" ("cohortId","courseId","releaseId","lessonId")
SELECT c.id,c."courseId",c."releaseId",l.id FROM "CourseCohort" c JOIN "Lesson" l ON l."releaseId"=c."releaseId"
WHERE NOT EXISTS (SELECT 1 FROM "CohortLessonSchedule" s WHERE s."cohortId"=c.id AND s."lessonId"=l.id);
UPDATE "CourseCohort" SET "scheduleFrozenAt"=now() WHERE state<>'DRAFT' AND "scheduleFrozenAt" IS NULL;
-- END LEGACY SCHEDULE

CREATE FUNCTION initialize_cohort_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO "CohortLessonSchedule" ("cohortId","courseId","releaseId","lessonId")
  SELECT NEW.id,NEW."courseId",NEW."releaseId",id FROM "Lesson" WHERE "releaseId"=NEW."releaseId";
  RETURN NEW;
END $$;
CREATE TRIGGER "CourseCohort_schedule_initialize" AFTER INSERT ON "CourseCohort" FOR EACH ROW EXECUTE FUNCTION initialize_cohort_schedule();

CREATE FUNCTION protect_cohort_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cohort "CourseCohort"%ROWTYPE;
BEGIN
  SELECT * INTO cohort FROM "CourseCohort" WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD."cohortId" ELSE NEW."cohortId" END FOR UPDATE;
  IF TG_OP='DELETE' AND NOT FOUND THEN RETURN OLD; END IF;
  IF cohort."scheduleFrozenAt" IS NOT NULL OR cohort.state<>'DRAFT' THEN RAISE EXCEPTION 'Cohort schedule is frozen'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."cohortId",NEW."courseId",NEW."releaseId",NEW."lessonId")
     IS DISTINCT FROM ROW(OLD.id,OLD."cohortId",OLD."courseId",OLD."releaseId",OLD."lessonId")
  THEN RAISE EXCEPTION 'Cohort schedule identity is immutable'; END IF;
  IF cohort."startsAt"+(NEW."opensOnDay"-1)*interval '24 hours'>=cohort."endsAt"
  THEN RAISE EXCEPTION 'Lesson opens outside cohort period'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CohortLessonSchedule_protect" BEFORE INSERT OR UPDATE OR DELETE ON "CohortLessonSchedule" FOR EACH ROW EXECUTE FUNCTION protect_cohort_schedule();

CREATE FUNCTION freeze_cohort_schedule() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND OLD."scheduleFrozenAt" IS NOT NULL AND NEW."scheduleFrozenAt" IS DISTINCT FROM OLD."scheduleFrozenAt"
  THEN RAISE EXCEPTION 'Cohort schedule cannot be unfrozen'; END IF;
  IF NEW.state<>'DRAFT' AND NEW."scheduleFrozenAt" IS NULL THEN NEW."scheduleFrozenAt"=now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CourseCohort_schedule_freeze" BEFORE UPDATE ON "CourseCohort" FOR EACH ROW EXECUTE FUNCTION freeze_cohort_schedule();
COMMIT;
