BEGIN;
ALTER TABLE "CourseCohort" ADD COLUMN "scheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("scheduleVersion">0), ADD COLUMN "changeReason" text;
ALTER TABLE "CohortRegistration" ADD COLUMN "acceptedScheduleVersion" integer NOT NULL DEFAULT 1 CHECK ("acceptedScheduleVersion">0), ADD COLUMN "originalScheduleSnapshot" jsonb, ADD COLUMN "scheduleSnapshot" jsonb;
CREATE TABLE "CohortScheduleChange" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "cohortId" text NOT NULL REFERENCES "CourseCohort"(id),
  "scheduleVersion" integer NOT NULL CHECK ("scheduleVersion">1),
  action text NOT NULL CHECK (action IN ('POSTPONE','CANCEL')),
  "beforeSnapshot" jsonb NOT NULL,
  "afterSnapshot" jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  "actorId" text NOT NULL REFERENCES "User"(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("cohortId","scheduleVersion")
);
CREATE FUNCTION protect_cohort_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Cohort schedule changes are immutable';
END $$;
CREATE TRIGGER "CohortScheduleChange_immutable" BEFORE UPDATE OR DELETE ON "CohortScheduleChange" FOR EACH ROW EXECUTE FUNCTION protect_cohort_change();
UPDATE "CohortRegistration" r SET "originalScheduleSnapshot"=jsonb_build_object('startsAt',c."startsAt",'endsAt',c."endsAt",'enrollDeadline',c."enrollDeadline",'scheduleVersion',c."scheduleVersion") FROM "CourseCohort" c WHERE c.id=r."cohortId";
CREATE FUNCTION initialize_cohort_registration_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cohort "CourseCohort"%ROWTYPE;
BEGIN
  SELECT * INTO cohort FROM "CourseCohort" WHERE id=NEW."cohortId" FOR SHARE;
  IF TG_OP='INSERT' THEN
    NEW."originalScheduleSnapshot"=jsonb_build_object('startsAt',cohort."startsAt",'endsAt',cohort."endsAt",'enrollDeadline',cohort."enrollDeadline",'scheduleVersion',cohort."scheduleVersion");
    NEW."acceptedScheduleVersion"=cohort."scheduleVersion";
  ELSIF NEW."originalScheduleSnapshot" IS DISTINCT FROM OLD."originalScheduleSnapshot" THEN
    RAISE EXCEPTION 'Original cohort registration schedule is immutable';
  END IF;
  IF TG_OP='UPDATE' AND NEW."acceptedScheduleVersion"<OLD."acceptedScheduleVersion" THEN RAISE EXCEPTION 'Cannot undo accepted cohort schedule'; END IF;
  IF NEW."acceptedScheduleVersion">cohort."scheduleVersion" THEN RAISE EXCEPTION 'Cannot accept a future cohort schedule'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CohortRegistration_schedule" BEFORE INSERT OR UPDATE ON "CohortRegistration" FOR EACH ROW EXECUTE FUNCTION initialize_cohort_registration_schedule();
ALTER TABLE "Assignment" ADD COLUMN "scheduleStartsAt" timestamptz;
ALTER TABLE "PracticeTask" ADD COLUMN "scheduleStartsAt" timestamptz;
UPDATE "Assignment" a SET "scheduleStartsAt"=c."startsAt" FROM "CourseCohort" c WHERE c.id=a."cohortId";
UPDATE "PracticeTask" a SET "scheduleStartsAt"=c."startsAt" FROM "CourseCohort" c WHERE c.id=a."cohortId";
CREATE FUNCTION initialize_teaching_schedule_anchor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='INSERT' AND NEW."cohortId" IS NOT NULL THEN
    SELECT "startsAt" INTO NEW."scheduleStartsAt" FROM "CourseCohort" WHERE id=NEW."cohortId";
  ELSIF TG_OP='UPDATE' AND NEW."scheduleStartsAt" IS DISTINCT FROM OLD."scheduleStartsAt" THEN
    IF TG_TABLE_NAME<>'Assignment' THEN RAISE EXCEPTION 'Teaching date anchor is immutable'; END IF;
    IF OLD.state<>'DRAFT' THEN RAISE EXCEPTION 'Published teaching date anchor is immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Assignment_schedule_anchor" BEFORE INSERT OR UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION initialize_teaching_schedule_anchor();
CREATE TRIGGER "PracticeTask_schedule_anchor" BEFORE INSERT OR UPDATE ON "PracticeTask" FOR EACH ROW EXECUTE FUNCTION initialize_teaching_schedule_anchor();
CREATE INDEX "CohortRegistration_schedule_notice" ON "CohortRegistration" ("cohortId",id);
INSERT INTO "OutboxJob" (kind,"aggregateType","aggregateId","eventKey",payload,"availableAt")
SELECT 'COHORT_END_NOTICE','cohort',id,'cohort.end:'||id||':'||"scheduleVersion",jsonb_build_object('scheduleVersion',"scheduleVersion",'action','END','reason','营期结束','cutoff',"endsAt"),"endsAt"
FROM "CourseCohort" WHERE state<>'CANCELLED' ON CONFLICT ("eventKey") DO NOTHING;
COMMIT;
