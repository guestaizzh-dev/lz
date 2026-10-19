BEGIN;
ALTER TABLE "PointsRedemption" ADD COLUMN "appointmentId" text UNIQUE REFERENCES "Appointment"(id),ADD COLUMN "returnCarrier" text,ADD COLUMN "returnTrackingNo" text,ADD COLUMN "returnProofAssetId" text REFERENCES "MediaAsset"(id);
ALTER TABLE "PointsRedemption" ADD COLUMN "returnInstructionsCipher" text,ADD COLUMN "returnReason" text,ADD COLUMN "returnPreviousState" text;
CREATE UNIQUE INDEX "PointsRedemption_orderId_key" ON "PointsRedemption"("orderId");
CREATE INDEX "PointsRedemption_user_created" ON "PointsRedemption"("userId","createdAt" DESC);
COMMIT;
