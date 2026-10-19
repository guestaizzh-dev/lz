ALTER TABLE "Refund" DROP CONSTRAINT "membership_refund_acceptance";
ALTER TABLE "Refund" ADD CONSTRAINT "membership_refund_acceptance" CHECK (
  "acceptedAt" IS NULL OR (
    "reasonCode" IN ('MEMBERSHIP_PARTIAL','BOOKING_DISPUTE')
    AND "assessmentSnapshot" IS NOT NULL AND "approvedAmount" > 0
  )
);
CREATE INDEX "booking_cancel_pending_item" ON "Appointment" ("orderItemId") WHERE state='CANCEL_PENDING';
CREATE INDEX "event_cancel_pending_item" ON "EventRegistration" ("orderItemId") WHERE state='CANCEL_PENDING';
ALTER TABLE "Refund" ADD CONSTRAINT "booking_dispute_consent" CHECK (
  "reasonCode" <> 'BOOKING_DISPUTE' OR (
    "assessmentSnapshot" IS NOT NULL
    AND (state NOT IN ('APPROVED','REFUNDING','FAILED','SUCCEEDED') OR (
      "approvedAmount" > 0 AND "assessmentSnapshot" ? 'proposalVersion'
    ))
    AND (state NOT IN ('REFUNDING','FAILED','SUCCEEDED') OR "acceptedAt" IS NOT NULL)
  )
);
CREATE FUNCTION protect_booking_refund_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD."reasonCode"='BOOKING_DISPUTE' AND OLD."acceptedAt" IS NOT NULL AND
    (NEW."orderId",NEW."userId",NEW."paymentTransactionId",NEW."reasonCode",NEW."requestedAmount",NEW."approvedAmount",NEW."assessmentSnapshot",NEW."acceptedAt",NEW."channelRequestKey") IS DISTINCT FROM
    (OLD."orderId",OLD."userId",OLD."paymentTransactionId",OLD."reasonCode",OLD."requestedAmount",OLD."approvedAmount",OLD."assessmentSnapshot",OLD."acceptedAt",OLD."channelRequestKey") THEN
    RAISE EXCEPTION 'Accepted booking refund proposal is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "booking_refund_consent" BEFORE UPDATE ON "Refund" FOR EACH ROW EXECUTE FUNCTION protect_booking_refund_consent();
