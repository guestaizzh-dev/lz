BEGIN;
CREATE TABLE "EventFulfilment" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "registrationId" text NOT NULL REFERENCES "EventRegistration"(id),
  "sessionId" text NOT NULL REFERENCES "EventSession"(id),
  revision integer NOT NULL CHECK (revision>0),
  "requestKey" text NOT NULL UNIQUE,
  "requestHash" text NOT NULL,
  "actorId" text NOT NULL REFERENCES "User"(id),
  outcome text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  "attendanceCount" integer NOT NULL CHECK ("attendanceCount" BETWEEN 0 AND quantity),
  "deliveredCount" integer NOT NULL CHECK ("deliveredCount" BETWEEN 0 AND "attendanceCount"),
  evidence text NOT NULL CHECK (length(trim(evidence)) BETWEEN 10 AND 1000),
  "publicSummary" text NOT NULL CHECK (length(trim("publicSummary")) BETWEEN 5 AND 500),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  "scheduleSnapshot" jsonb NOT NULL,
  "attendanceSnapshot" jsonb NOT NULL,
  UNIQUE ("registrationId",revision),
  CHECK (outcome=CASE WHEN "attendanceCount"=0 THEN 'NO_SHOW' WHEN "deliveredCount"=0 THEN 'NOT_DELIVERED' WHEN "deliveredCount"=quantity THEN 'COMPLETED' ELSE 'PARTIAL' END)
);
CREATE INDEX "EventFulfilment_session" ON "EventFulfilment" ("sessionId","registrationId",revision DESC);
CREATE FUNCTION protect_event_fulfilment_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r "EventRegistration"; s "EventSession"; ticket_session text; last_revision integer; arrived integer;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Fulfilment facts cannot be rewritten or deleted'; END IF;
  SELECT * INTO r FROM "EventRegistration" WHERE id=NEW."registrationId" FOR UPDATE;
  SELECT "sessionId" INTO ticket_session FROM "EventTicketType" WHERE id=r."ticketTypeId";
  SELECT * INTO s FROM "EventSession" WHERE id=NEW."sessionId" FOR SHARE;
  IF r.id IS NULL OR s.id IS NULL OR ticket_session<>s.id OR s.state='CANCELLED' OR s."endsAt">clock_timestamp() OR r.state NOT IN ('CONFIRMED','COMPLETED') OR r."acceptedScheduleVersion"<s."scheduleVersion" OR r."orderItemId" IS NOT NULL OR r."benefitUsageId" IS NOT NULL OR NEW.quantity<>r.quantity
  THEN RAISE EXCEPTION 'Registration is not eligible for free event fulfilment'; END IF;
  SELECT coalesce(max(revision),0) INTO last_revision FROM "EventFulfilment" WHERE "registrationId"=r.id;
  SELECT count(*) INTO arrived FROM "EventCheckin" WHERE "registrationId"=r.id AND "revokedAt" IS NULL;
  IF NEW.revision<>last_revision+1 OR NEW."attendanceCount"<>arrived THEN RAISE EXCEPTION 'Fulfilment revision or attendance is stale'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "EventFulfilment_fact" BEFORE INSERT OR UPDATE OR DELETE ON "EventFulfilment" FOR EACH ROW EXECUTE FUNCTION protect_event_fulfilment_fact();
COMMIT;
