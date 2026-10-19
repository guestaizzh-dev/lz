CREATE TABLE "ConsumptionReward" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 "userId" text NOT NULL REFERENCES "User"(id), "orderId" text NOT NULL UNIQUE REFERENCES "TradeOrder"(id), "ruleSnapshot" jsonb NOT NULL,
 "peakAmount" bigint NOT NULL DEFAULT 0 CHECK("peakAmount">=0), "currentAmount" bigint NOT NULL DEFAULT 0 CHECK("currentAmount">=0),
 points bigint NOT NULL DEFAULT 0 CHECK(points>=0), growth integer NOT NULL DEFAULT 0 CHECK(growth>=0),
 state text NOT NULL DEFAULT 'WAIT_DELIVERY' CHECK(state IN ('WAIT_DELIVERY','OBSERVATION','HELD','SETTLED','REVERSED')),
 "eligibleAt" timestamptz, "pendingRefund" boolean NOT NULL DEFAULT false, "sourceHash" text NOT NULL DEFAULT '', "sourceSnapshot" jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX "ConsumptionReward_userId_createdAt_idx" ON "ConsumptionReward"("userId","createdAt");
CREATE TABLE "ConsumptionAward" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, "createdAt" timestamptz NOT NULL DEFAULT now(),
 "userId" text NOT NULL REFERENCES "User"(id), "rewardId" text NOT NULL REFERENCES "ConsumptionReward"(id), "eventKey" text NOT NULL UNIQUE,
 amount bigint NOT NULL CHECK(amount>0), points bigint NOT NULL CHECK(points>=0), growth integer NOT NULL CHECK(growth>=0), "businessDay" date NOT NULL, "ruleSnapshot" jsonb NOT NULL
);
CREATE INDEX "ConsumptionAward_userId_businessDay_idx" ON "ConsumptionAward"("userId","businessDay");
CREATE FUNCTION validate_consumption_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ConsumptionReward' THEN
  IF NOT EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=NEW."orderId" AND "userId"=NEW."userId" AND kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT','COHORT') AND "pricingSnapshot"->'consumptionRule'=NEW."ruleSnapshot") THEN RAISE EXCEPTION 'Consumption reward must match its original owner and frozen policy'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "ConsumptionReward" WHERE id=NEW."rewardId" AND "userId"=NEW."userId") THEN RAISE EXCEPTION 'Consumption allocation must match reward owner'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_reward_source BEFORE INSERT OR UPDATE ON "ConsumptionReward" FOR EACH ROW EXECUTE FUNCTION validate_consumption_source();
CREATE TRIGGER consumption_award_source BEFORE INSERT ON "ConsumptionAward" FOR EACH ROW EXECUTE FUNCTION validate_consumption_source();
CREATE FUNCTION consumption_order_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  NEW."pricingSnapshot":=NEW."pricingSnapshot"-'consumptionRule';
  IF OLD."pricingSnapshot" ? 'consumptionRule' THEN
   NEW."pricingSnapshot":=NEW."pricingSnapshot"||jsonb_build_object('consumptionRule',OLD."pricingSnapshot"->'consumptionRule');
  END IF;
 ELSIF NEW."payableTotal">0 AND NEW.kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT','COHORT') AND NEW.currency='CNY'
  AND NOT(coalesce(NEW."pricingSnapshot"->>'channel','')='APPLE_IAP' AND NEW."paidAt" IS NOT NULL AND NEW."paidAt"<TIMESTAMPTZ '2026-10-18 00:00:00+08') THEN
  NEW."pricingSnapshot":=NEW."pricingSnapshot"||jsonb_build_object('consumptionRule','{"version":"CONSUMPTION_20261018_V1","pointsUnit":100,"growthUnit":1000,"pointsDailyLimit":500,"growthDailyLimit":20,"observationDays":7}'::jsonb);
 ELSE
  NEW."pricingSnapshot":=NEW."pricingSnapshot"-'consumptionRule';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumption_order_policy BEFORE INSERT OR UPDATE ON "TradeOrder" FOR EACH ROW EXECUTE FUNCTION consumption_order_policy();
CREATE FUNCTION enqueue_consumption_order(target text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF target IS NULL OR NOT EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=target AND "pricingSnapshot" ? 'consumptionRule') THEN RETURN; END IF;
 INSERT INTO "OutboxJob"("eventKey",kind,"aggregateType","aggregateId",payload,"availableAt") VALUES ('consumption.sync:'||target,'CONSUMPTION_SYNC','TRADE_ORDER',target,'{"dirty":true}',now())
 ON CONFLICT("eventKey") DO UPDATE SET state='READY',payload='{"dirty":true}',"availableAt"=now(),"lockedUntil"=NULL,"completedAt"=NULL,"lastErrorCode"=NULL,attempts=0,version="OutboxJob".version+1,"updatedAt"=now();
END $$;
CREATE FUNCTION consumption_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='TradeOrder' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='Membership' THEN SELECT "orderId" INTO target FROM "TradeOrderItem" WHERE id=NEW."orderItemId";
 ELSIF TG_TABLE_NAME='AppleTransactionState' THEN SELECT "orderId" INTO target FROM "PaymentTransaction" WHERE id=NEW."paymentId";
 ELSIF TG_TABLE_NAME='RefundItem' THEN SELECT "orderId" INTO target FROM "Refund" WHERE id=NEW."refundId";
 ELSIF TG_TABLE_NAME='FinanceEntry' THEN SELECT "orderId" INTO target FROM "FinanceJournal" WHERE id=NEW."journalId";
 ELSE target:=NEW."orderId";
 END IF;
 PERFORM enqueue_consumption_order(target);RETURN NEW;
END $$;
CREATE TRIGGER consumption_trade_order AFTER INSERT OR UPDATE ON "TradeOrder" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_order_item AFTER INSERT OR UPDATE ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_payment AFTER INSERT OR UPDATE ON "PaymentTransaction" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_refund AFTER INSERT OR UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_refund_item AFTER INSERT OR UPDATE ON "RefundItem" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_journal AFTER INSERT OR UPDATE ON "FinanceJournal" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_entry AFTER INSERT ON "FinanceEntry" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_delivery AFTER INSERT OR UPDATE ON "ServiceDelivery" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_shipment AFTER INSERT OR UPDATE ON "Shipment" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_member AFTER INSERT OR UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION consumption_change();
CREATE TRIGGER consumption_apple AFTER INSERT OR UPDATE ON "AppleTransactionState" FOR EACH ROW EXECUTE FUNCTION consumption_change();
-- Existing orders, paid facts and balances are not rewritten or retroactively rewarded.
