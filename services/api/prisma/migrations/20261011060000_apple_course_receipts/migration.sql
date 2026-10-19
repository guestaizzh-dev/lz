-- Binding and verified receipt facts survive account closure for financial traceability.
ALTER TABLE "ChannelProductMapping" ADD COLUMN "deactivatedAt" timestamptz;
ALTER TABLE "ChannelProductMapping" ADD COLUMN "activatedAt" timestamptz;
CREATE TABLE "AppleAccountBinding" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" text NOT NULL REFERENCES "User"(id),
  "appScope" text NOT NULL,
  "accountToken" text NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("userId","appScope"), UNIQUE(id,"appScope")
);
CREATE TABLE "AppleOriginalPurchase" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "bindingId" text NOT NULL,
  "appScope" text NOT NULL,
  "originalTransactionId" text NOT NULL CHECK ("originalTransactionId" ~ '^[0-9]{1,40}$'),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("appScope","originalTransactionId"),
  UNIQUE(id,"appScope","originalTransactionId"),
  FOREIGN KEY ("bindingId","appScope") REFERENCES "AppleAccountBinding"(id,"appScope")
);
CREATE TABLE "AppleTransactionState" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "appScope" text NOT NULL,
  "transactionId" text NOT NULL CHECK ("transactionId" ~ '^[0-9]{1,40}$'),
  "originalTransactionId" text NOT NULL,
  "accountToken" text NOT NULL,
  "originalPurchaseId" text,
  "mappingId" text REFERENCES "ChannelProductMapping"(id),
  "mappingSnapshot" jsonb,
  "paymentId" text UNIQUE REFERENCES "PaymentTransaction"(id),
  facts jsonb NOT NULL,
  "latestSignedAt" timestamptz NOT NULL,
  "revokedAt" timestamptz,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','REVOKED','REVIEW')),
  "issueCode" text,
  "queryFailureCode" text,
  "lastCheckedAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE("appScope","transactionId"),
  FOREIGN KEY ("originalPurchaseId","appScope","originalTransactionId") REFERENCES "AppleOriginalPurchase"(id,"appScope","originalTransactionId")
);
CREATE INDEX "AppleTransactionState_state_lastCheckedAt_idx" ON "AppleTransactionState"(state,"lastCheckedAt");
CREATE FUNCTION protect_apple_purchase_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='ChannelProductMapping' THEN
    IF OLD.channel='APPLE_IAP' AND ROW(NEW.channel,NEW."appScope",NEW."externalProductId",NEW."offerId",NEW."productType",NEW.currency,NEW."priceMinor",NEW."minorExponent",NEW."createdAt") IS DISTINCT FROM ROW(OLD.channel,OLD."appScope",OLD."externalProductId",OLD."offerId",OLD."productType",OLD.currency,OLD."priceMinor",OLD."minorExponent",OLD."createdAt") THEN
      RAISE EXCEPTION 'Apple product identity and original pricing are immutable';
    END IF;
  ELSIF TG_TABLE_NAME IN ('AppleAccountBinding','AppleOriginalPurchase') THEN
    IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Apple purchase ownership is immutable'; END IF;
  ELSE
    IF ROW(NEW."appScope",NEW."transactionId",NEW."originalTransactionId",NEW."accountToken",NEW."createdAt") IS DISTINCT FROM ROW(OLD."appScope",OLD."transactionId",OLD."originalTransactionId",OLD."accountToken",OLD."createdAt")
      OR OLD."paymentId" IS NOT NULL AND NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
      OR OLD."mappingSnapshot" IS NOT NULL AND NEW."mappingSnapshot" IS DISTINCT FROM OLD."mappingSnapshot"
      OR OLD."originalPurchaseId" IS NOT NULL AND NEW."originalPurchaseId" IS DISTINCT FROM OLD."originalPurchaseId"
      OR NEW."latestSignedAt"<OLD."latestSignedAt" THEN RAISE EXCEPTION 'Apple receipt identity and bound purchase facts are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apple_mapping_identity BEFORE UPDATE ON "ChannelProductMapping" FOR EACH ROW EXECUTE FUNCTION protect_apple_purchase_identity();
CREATE TRIGGER apple_account_identity BEFORE UPDATE ON "AppleAccountBinding" FOR EACH ROW EXECUTE FUNCTION protect_apple_purchase_identity();
CREATE TRIGGER apple_original_identity BEFORE UPDATE ON "AppleOriginalPurchase" FOR EACH ROW EXECUTE FUNCTION protect_apple_purchase_identity();
CREATE TRIGGER apple_receipt_identity BEFORE UPDATE ON "AppleTransactionState" FOR EACH ROW EXECUTE FUNCTION protect_apple_purchase_identity();
INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('APPLE_RECEIVABLE','Apple渠道待结算款','ASSET') ON CONFLICT(code) DO NOTHING;
