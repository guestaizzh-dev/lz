BEGIN;
ALTER TABLE "Notification" ADD COLUMN "cohortId" text REFERENCES "CourseCohort"(id);
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_cohort_course" FOREIGN KEY ("cohortId","courseId") REFERENCES "CourseCohort"(id,"courseId");
ALTER TABLE "PracticeTask" ADD CONSTRAINT "PracticeTask_cohort_course" FOREIGN KEY ("cohortId","courseId") REFERENCES "CourseCohort"(id,"courseId");
CREATE UNIQUE INDEX "CourseStaff_active_context" ON "CourseStaff" ("courseId","cohortId","userId") NULLS NOT DISTINCT WHERE "revokedAt" IS NULL;
CREATE INDEX "Assignment_cohort_state" ON "Assignment" ("cohortId",state);
CREATE INDEX "PracticeTask_cohort" ON "PracticeTask" ("cohortId");
CREATE FUNCTION protect_teaching_context() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cohort "CourseCohort"%ROWTYPE;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.id,NEW."courseId",NEW."cohortId") IS DISTINCT FROM ROW(OLD.id,OLD."courseId",OLD."cohortId")
  THEN RAISE EXCEPTION 'Teaching context is immutable'; END IF;
  IF NEW."cohortId" IS NOT NULL THEN
    SELECT * INTO cohort FROM "CourseCohort" WHERE id=NEW."cohortId";
    IF NEW."lessonId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Lesson" WHERE id=NEW."lessonId" AND "releaseId"=cohort."releaseId")
    THEN RAISE EXCEPTION 'Lesson does not belong to the cohort release'; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='Assignment' THEN
    IF OLD.state<>'DRAFT' AND ROW(NEW.title,NEW.instructions,NEW."lessonId",NEW."dueAt",NEW.required,NEW."allowedKinds") IS DISTINCT FROM ROW(OLD.title,OLD.instructions,OLD."lessonId",OLD."dueAt",OLD.required,OLD."allowedKinds")
    THEN RAISE EXCEPTION 'Published assignment is immutable'; END IF;
    ELSE
    IF ROW(NEW.title,NEW.instructions-'active',NEW."lessonId",NEW.frequency,NEW."requiredDays",NEW."startsOn",NEW."endsOn",NEW.required) IS DISTINCT FROM ROW(OLD.title,OLD.instructions-'active',OLD."lessonId",OLD.frequency,OLD."requiredDays",OLD."startsOn",OLD."endsOn",OLD.required)
    THEN RAISE EXCEPTION 'Published practice requirements are immutable'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Assignment_context" BEFORE INSERT OR UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION protect_teaching_context();
CREATE TRIGGER "PracticeTask_context" BEFORE INSERT OR UPDATE ON "PracticeTask" FOR EACH ROW EXECUTE FUNCTION protect_teaching_context();
COMMIT;
