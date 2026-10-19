BEGIN;
ALTER TABLE "TradeOrder" DROP CONSTRAINT "domain_TradeOrder_4";
ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_4" CHECK(kind IN ('COURSE','COHORT','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE'));
ALTER TABLE "SaleOffer" DROP CONSTRAINT "domain_SaleOffer_0", DROP CONSTRAINT "domain_SaleOffer_1";
ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_0" CHECK(kind IN ('COURSE','COHORT','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE'));
ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_1" CHECK(
  num_nonnulls("courseReleaseId","cohortId","skuId","membershipVersionId","serviceOfferingId","eventTicketId","giftId","operatingServiceId")=1
  AND (kind='COHORT')=("cohortId" IS NOT NULL)
);
ALTER TABLE "CohortRegistration" DROP CONSTRAINT "CohortRegistration_source_check";
ALTER TABLE "CohortRegistration" ADD COLUMN "orderItemId" text UNIQUE REFERENCES "TradeOrderItem"(id), ADD COLUMN "suspendedAt" timestamptz;
ALTER TABLE "CohortRegistration" ADD CONSTRAINT "cohort_registration_source" CHECK (
  (source='COHORT_FREE' AND "orderItemId" IS NULL AND "suspendedAt" IS NULL) OR (source='COHORT_PURCHASE' AND "orderItemId" IS NOT NULL)
);
CREATE UNIQUE INDEX "cohort_reservation_order_item" ON "InventoryReservation"("orderItemId") WHERE "cohortId" IS NOT NULL;
CREATE UNIQUE INDEX "cohort_one_active_offer" ON "SaleOffer"("cohortId") WHERE kind='COHORT' AND active=true;
CREATE INDEX "cohort_pending_orders" ON "TradeOrder"("userId",state,"createdAt") WHERE kind='COHORT';
INSERT INTO "SaleOffer" (id,kind,"cohortId",price,active,"quantityLimit","policySnapshot")
SELECT gen_random_uuid()::text,'COHORT',id,0,true,1,'{}'::jsonb FROM "CourseCohort" c
WHERE NOT EXISTS(SELECT 1 FROM "SaleOffer" s WHERE s."cohortId"=c.id);
INSERT INTO "FinanceAccount"(code,title,kind) VALUES
('COHORT_ADVANCE','训练营待交付预收款','LIABILITY'),('COHORT_REFUND_PAYABLE','训练营异常收款待退','LIABILITY'),('COHORT_REVENUE','训练营交付收入','REVENUE') ON CONFLICT(code) DO NOTHING;
CREATE FUNCTION protect_cohort_paid_registration() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' AND OLD.source='COHORT_PURCHASE' AND
    (NEW."userId",NEW."cohortId",NEW."courseId",NEW."releaseId",NEW.source,NEW."orderItemId",NEW."originalScheduleSnapshot") IS DISTINCT FROM
    (OLD."userId",OLD."cohortId",OLD."courseId",OLD."releaseId",OLD.source,OLD."orderItemId",OLD."originalScheduleSnapshot") THEN
    RAISE EXCEPTION 'Purchased cohort registration identity is immutable';
  END IF;
  IF NEW.source='COHORT_PURCHASE' AND NOT EXISTS(
    SELECT 1 FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId"
    JOIN "PaymentTransaction" p ON p."orderId"=o.id AND p.disposition='ACCEPTED'
    JOIN "InventoryReservation" r ON r."orderItemId"=i.id AND r."cohortId"=NEW."cohortId"
    WHERE i.id=NEW."orderItemId" AND o.kind='COHORT' AND o."userId"=NEW."userId" AND i."courseReleaseId"=NEW."releaseId"
    AND i."itemSnapshot"->>'cohortId'=NEW."cohortId" AND p.amount=i.payable
  ) THEN RAISE EXCEPTION 'Cohort registration requires verified matching purchase'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cohort_paid_registration" BEFORE INSERT OR UPDATE ON "CohortRegistration" FOR EACH ROW EXECUTE FUNCTION protect_cohort_paid_registration();
CREATE FUNCTION protect_cohort_purchase_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=OLD."orderId" AND kind='COHORT') AND
    (NEW."orderId",NEW."offerId",NEW."courseReleaseId",NEW.quantity,NEW."unitPrice",NEW.subtotal,NEW.payable,NEW."itemSnapshot",NEW."benefitSnapshot") IS DISTINCT FROM
    (OLD."orderId",OLD."offerId",OLD."courseReleaseId",OLD.quantity,OLD."unitPrice",OLD.subtotal,OLD.payable,OLD."itemSnapshot",OLD."benefitSnapshot") THEN
    RAISE EXCEPTION 'Cohort purchase snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cohort_purchase_snapshot" BEFORE UPDATE ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION protect_cohort_purchase_snapshot();
COMMIT;
