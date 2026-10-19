BEGIN;
ALTER TABLE "EventRegistration" ADD COLUMN "checkinExpiresAt" timestamptz;
ALTER TABLE "EventCheckin" ADD COLUMN "revokedAt" timestamptz, ADD COLUMN "revokedBy" text REFERENCES "User"(id), ADD COLUMN "revokeReason" text;
ALTER TABLE "EventCheckin" DROP CONSTRAINT "domain_EventCheckin_0";
CREATE UNIQUE INDEX "EventCheckin_active_attendee" ON "EventCheckin" ("registrationId","attendeeNo") WHERE "revokedAt" IS NULL;
ALTER TABLE "EventCheckin" ADD CONSTRAINT "EventCheckin_revocation_complete" CHECK (("revokedAt" IS NULL AND "revokedBy" IS NULL AND "revokeReason" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND length(trim("revokeReason")) BETWEEN 1 AND 500));
CREATE FUNCTION protect_event_checkin_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Checkin facts cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW."registrationId",NEW."attendeeNo",NEW."actorId",NEW."requestKey",NEW."checkedAt",NEW."createdAt") IS DISTINCT FROM ROW(OLD.id,OLD."registrationId",OLD."attendeeNo",OLD."actorId",OLD."requestKey",OLD."checkedAt",OLD."createdAt") OR OLD."revokedAt" IS NOT NULL
  THEN RAISE EXCEPTION 'Checkin facts and reversals are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EventCheckin_fact" BEFORE UPDATE OR DELETE ON "EventCheckin" FOR EACH ROW EXECUTE FUNCTION protect_event_checkin_fact();
COMMIT;
