CREATE TABLE "ServiceDelivery" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 "orderId" text NOT NULL REFERENCES "TradeOrder"(id), "orderItemId" text NOT NULL REFERENCES "TradeOrderItem"(id),
 revision integer NOT NULL CHECK(revision>0), "requestKey" text NOT NULL UNIQUE, "requestHash" text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED')),
 outcome text NOT NULL CHECK(outcome IN ('COMPLETED','PARTIAL','NOT_DELIVERED','NO_SHOW')),
 "deliveredUnits" integer NOT NULL, "totalUnits" integer NOT NULL,
 "recognizedAmount" bigint NOT NULL CHECK("recognizedAmount">=0),
 "publicSummary" text NOT NULL, "evidenceCipher" text NOT NULL,
 "proofAssetId" text NOT NULL REFERENCES "MediaAsset"(id), "proofHash" text NOT NULL,
 "contextSnapshot" jsonb NOT NULL,
 "proposerId" text NOT NULL REFERENCES "User"(id), "reviewerId" text REFERENCES "User"(id),
 "reviewedAt" timestamptz, "reviewNote" text, reason text NOT NULL,
 "journalId" text UNIQUE REFERENCES "FinanceJournal"(id),
 UNIQUE("orderItemId",revision),
 CHECK("totalUnits">0 AND "deliveredUnits">=0 AND "deliveredUnits"<="totalUnits"),
 CHECK((outcome='COMPLETED' AND "deliveredUnits"="totalUnits") OR (outcome='PARTIAL' AND "deliveredUnits">0 AND "deliveredUnits"<="totalUnits") OR (outcome IN ('NOT_DELIVERED','NO_SHOW') AND "deliveredUnits"=0 AND "recognizedAmount"=0)),
 CHECK((state='PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL) OR (state<>'PENDING' AND "reviewerId" IS NOT NULL AND "reviewerId"<>"proposerId" AND "reviewedAt" IS NOT NULL))
);
CREATE INDEX "ServiceDelivery_orderId_createdAt_idx" ON "ServiceDelivery"("orderId","createdAt");
CREATE UNIQUE INDEX service_delivery_pending ON "ServiceDelivery"("orderItemId") WHERE state='PENDING';
CREATE FUNCTION validate_service_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId" WHERE i.id=NEW."orderItemId" AND o.id=NEW."orderId" AND o.kind IN ('CONSULTATION','EVENT','COHORT')) THEN
  RAISE EXCEPTION 'Service delivery must belong to its paid service order';
 END IF;
 IF NEW.version<1 OR NEW."proofHash" !~ '^[a-f0-9]{64}$' OR NEW."requestHash" !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid service delivery revision or evidence hash'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER service_delivery_source BEFORE INSERT OR UPDATE ON "ServiceDelivery" FOR EACH ROW EXECUTE FUNCTION validate_service_delivery();
