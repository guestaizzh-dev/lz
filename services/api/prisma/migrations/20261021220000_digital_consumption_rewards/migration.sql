-- Only new digital orders freeze a consumption policy; historical facts remain unchanged.
CREATE OR REPLACE FUNCTION validate_consumption_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='ConsumptionReward' THEN
  IF NOT EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=NEW."orderId" AND "userId"=NEW."userId" AND kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT','COHORT','DIGITAL') AND "pricingSnapshot"->'consumptionRule'=NEW."ruleSnapshot") THEN RAISE EXCEPTION 'Consumption reward must match its original owner and frozen policy'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM "ConsumptionReward" WHERE id=NEW."rewardId" AND "userId"=NEW."userId") THEN RAISE EXCEPTION 'Consumption allocation must match reward owner'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION consumption_order_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  NEW."pricingSnapshot":=NEW."pricingSnapshot"-'consumptionRule';
  IF OLD."pricingSnapshot" ? 'consumptionRule' THEN
   NEW."pricingSnapshot":=NEW."pricingSnapshot"||jsonb_build_object('consumptionRule',OLD."pricingSnapshot"->'consumptionRule');
  END IF;
 ELSIF NEW."payableTotal">0 AND NEW.kind IN ('COURSE','MEMBERSHIP','PHYSICAL','CONSULTATION','EVENT','COHORT','DIGITAL') AND NEW.currency='CNY'
  AND NOT(coalesce(NEW."pricingSnapshot"->>'channel','')='APPLE_IAP' AND NEW."paidAt" IS NOT NULL AND NEW."paidAt"<TIMESTAMPTZ '2026-10-18 00:00:00+08') THEN
  NEW."pricingSnapshot":=NEW."pricingSnapshot"||jsonb_build_object('consumptionRule','{"version":"CONSUMPTION_20261018_V1","pointsUnit":100,"growthUnit":1000,"pointsDailyLimit":500,"growthDailyLimit":20,"observationDays":7}'::jsonb);
 ELSE
  NEW."pricingSnapshot":=NEW."pricingSnapshot"-'consumptionRule';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION consumption_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='TradeOrder' THEN target:=NEW.id;
 ELSIF TG_TABLE_NAME='DigitalDelivery' THEN SELECT "orderId" INTO target FROM "TradeOrderItem" WHERE id=NEW."orderItemId";
 ELSIF TG_TABLE_NAME='Membership' THEN SELECT "orderId" INTO target FROM "TradeOrderItem" WHERE id=NEW."orderItemId";
 ELSIF TG_TABLE_NAME='AppleTransactionState' THEN SELECT "orderId" INTO target FROM "PaymentTransaction" WHERE id=NEW."paymentId";
 ELSIF TG_TABLE_NAME='RefundItem' THEN SELECT "orderId" INTO target FROM "Refund" WHERE id=NEW."refundId";
 ELSIF TG_TABLE_NAME='FinanceEntry' THEN SELECT "orderId" INTO target FROM "FinanceJournal" WHERE id=NEW."journalId";
 ELSE target:=NEW."orderId";
 END IF;
 PERFORM enqueue_consumption_order(target);RETURN NEW;
END $$;
CREATE TRIGGER consumption_digital_delivery AFTER INSERT OR UPDATE ON "DigitalDelivery" FOR EACH ROW EXECUTE FUNCTION consumption_change();
