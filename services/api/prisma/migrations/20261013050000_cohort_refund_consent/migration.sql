BEGIN;
ALTER TABLE "Refund" DROP CONSTRAINT "membership_refund_acceptance";
ALTER TABLE "Refund" ADD CONSTRAINT "membership_refund_acceptance" CHECK (
  "acceptedAt" IS NULL OR (
    "reasonCode" IN ('MEMBERSHIP_PARTIAL','BOOKING_DISPUTE','COHORT_DISPUTE')
    AND "assessmentSnapshot" IS NOT NULL AND "approvedAmount">0
  )
);
ALTER TABLE "Refund" ADD CONSTRAINT "cohort_dispute_consent" CHECK (
  "reasonCode"<>'COHORT_DISPUTE' OR (
    "assessmentSnapshot" IS NOT NULL
    AND (state NOT IN ('APPROVED','REFUNDING','FAILED','SUCCEEDED') OR (
      "approvedAmount">0 AND "assessmentSnapshot" ? 'proposalVersion'
    ))
    AND (state NOT IN ('REFUNDING','FAILED','SUCCEEDED') OR "acceptedAt" IS NOT NULL)
  )
);
CREATE FUNCTION protect_cohort_refund_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD."reasonCode"='COHORT_DISPUTE' AND OLD."acceptedAt" IS NOT NULL AND
    (NEW."orderId",NEW."userId",NEW."paymentTransactionId",NEW."reasonCode",NEW."requestedAmount",NEW."approvedAmount",NEW."assessmentSnapshot",NEW."acceptedAt",NEW."channelRequestKey") IS DISTINCT FROM
    (OLD."orderId",OLD."userId",OLD."paymentTransactionId",OLD."reasonCode",OLD."requestedAmount",OLD."approvedAmount",OLD."assessmentSnapshot",OLD."acceptedAt",OLD."channelRequestKey") THEN
    RAISE EXCEPTION 'Accepted cohort refund proposal is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cohort_refund_consent" BEFORE UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_cohort_refund_consent();
CREATE FUNCTION protect_cohort_refund_item_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM "Refund" WHERE id=OLD."refundId" AND "reasonCode"='COHORT_DISPUTE' AND "acceptedAt" IS NOT NULL) AND
    (NEW."refundId",NEW."orderItemId",NEW.quantity,NEW.amount,NEW."revokeQuantity") IS DISTINCT FROM
    (OLD."refundId",OLD."orderItemId",OLD.quantity,OLD.amount,OLD."revokeQuantity") THEN
    RAISE EXCEPTION 'Accepted cohort refund line is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "cohort_refund_item_consent" BEFORE UPDATE ON "RefundItem" FOR EACH ROW EXECUTE FUNCTION protect_cohort_refund_item_consent();
ALTER TABLE "CohortScheduleChange" DROP CONSTRAINT "CohortScheduleChange_action_check";
ALTER TABLE "CohortScheduleChange" ADD CONSTRAINT "CohortScheduleChange_action_check" CHECK(action IN ('POSTPONE','EXTEND','CANCEL'));
CREATE INDEX "cohort_suspended_registrations" ON "CohortRegistration"("cohortId","orderItemId") WHERE "suspendedAt" IS NOT NULL AND "revokedAt" IS NULL;
COMMIT;
