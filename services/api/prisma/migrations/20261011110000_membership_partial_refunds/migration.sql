ALTER TABLE "Refund" ADD COLUMN "assessmentSnapshot" jsonb;
ALTER TABLE "Refund" ADD COLUMN "acceptedAt" timestamptz;
ALTER TABLE "Refund" ADD CONSTRAINT "membership_refund_assessment_object"
  CHECK ("assessmentSnapshot" IS NULL OR jsonb_typeof("assessmentSnapshot") = 'object');
ALTER TABLE "Refund" ADD CONSTRAINT "membership_refund_acceptance"
  CHECK ("acceptedAt" IS NULL OR ("reasonCode" = 'MEMBERSHIP_PARTIAL' AND "assessmentSnapshot" IS NOT NULL AND "approvedAmount" > 0));
