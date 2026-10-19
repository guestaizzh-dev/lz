BEGIN;
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('EVENT_PRIORITY','活动优先报名','PRIORITY','{"enabled":"boolean"}',true)
ON CONFLICT (code) DO NOTHING;
-- Historical memberships keep their purchased version; the new benefit is opt-in for new versions.
ALTER TABLE "EventSession" ADD CONSTRAINT "EventSession_priority_window" CHECK ("memberOpenAt" IS NULL OR "memberOpenAt"<"publicOpenAt");
ALTER TABLE "EventRegistration" ADD COLUMN "prioritySnapshot" jsonb;
CREATE FUNCTION protect_event_priority_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW."prioritySnapshot" IS DISTINCT FROM OLD."prioritySnapshot" THEN RAISE EXCEPTION 'Confirmed priority admission is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EventRegistration_priority_snapshot" BEFORE UPDATE ON "EventRegistration" FOR EACH ROW EXECUTE FUNCTION protect_event_priority_snapshot();
COMMIT;
