BEGIN;
CREATE TABLE "AppleRefundReview" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1 CHECK(version>0),
 "receiptId" text NOT NULL REFERENCES "AppleTransactionState"(id),"paymentId" text NOT NULL REFERENCES "PaymentTransaction"(id),"cycleHash" text NOT NULL CHECK("cycleHash"~'^[a-f0-9]{64}$'),
 amount bigint NOT NULL CHECK(amount>0 AND amount<=100000000),currency text NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
 "proofAssetId" text NOT NULL REFERENCES "MediaAsset"(id),"proofHash" text NOT NULL CHECK("proofHash"~'^[a-f0-9]{64}$'),reference text NOT NULL CHECK(length(reference) BETWEEN 4 AND 120),note text NOT NULL CHECK(length(note) BETWEEN 10 AND 1000),
 "submittedBy" text NOT NULL REFERENCES "User"(id),"requestKey" text NOT NULL,"requestHash" text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','CONFIRMED','REJECTED')),"reviewedBy" text REFERENCES "User"(id),"reviewedAt" timestamptz,"reviewNote" text,"refundId" text UNIQUE REFERENCES "Refund"(id),UNIQUE("submittedBy","requestKey"),
 CHECK((state='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "refundId" IS NULL) OR (state IN ('CONFIRMED','REJECTED') AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length("reviewNote")>=2 AND ((state='CONFIRMED' AND "refundId" IS NOT NULL AND "reviewedBy"<>"submittedBy") OR (state='REJECTED' AND "refundId" IS NULL)))));
CREATE INDEX "AppleRefundReview_receiptId_createdAt_idx" ON "AppleRefundReview"("receiptId","createdAt");
CREATE UNIQUE INDEX "AppleRefundReview_pending_cycle" ON "AppleRefundReview"("receiptId","cycleHash") WHERE state='PENDING';
CREATE FUNCTION protect_apple_refund_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Apple refund review history is immutable'; END IF;
 IF OLD.state<>'PENDING' OR NEW.state NOT IN ('CONFIRMED','REJECTED') OR NEW.version<>OLD.version+1 OR
 ROW(NEW.id,NEW."createdAt",NEW."receiptId",NEW."paymentId",NEW."cycleHash",NEW.amount,NEW.currency,NEW."proofAssetId",NEW."proofHash",NEW.reference,NEW.note,NEW."submittedBy",NEW."requestKey",NEW."requestHash") IS DISTINCT FROM
 ROW(OLD.id,OLD."createdAt",OLD."receiptId",OLD."paymentId",OLD."cycleHash",OLD.amount,OLD.currency,OLD."proofAssetId",OLD."proofHash",OLD.reference,OLD.note,OLD."submittedBy",OLD."requestKey",OLD."requestHash") THEN RAISE EXCEPTION 'Apple refund review facts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER apple_refund_review_immutable BEFORE UPDATE OR DELETE ON "AppleRefundReview" FOR EACH ROW EXECUTE FUNCTION protect_apple_refund_review();
COMMIT;
