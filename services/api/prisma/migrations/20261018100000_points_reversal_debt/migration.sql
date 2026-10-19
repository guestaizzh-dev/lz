ALTER TABLE "PointsAccount" ADD COLUMN "debt" bigint NOT NULL DEFAULT 0;
ALTER TABLE "PointsAccount" ADD CONSTRAINT points_debt_nonnegative CHECK (debt >= 0);
ALTER TABLE "PointsLedger" ADD COLUMN "debtDelta" bigint NOT NULL DEFAULT 0;
ALTER TABLE "PointsLedger" ADD COLUMN "debtAfter" bigint NOT NULL DEFAULT 0;
ALTER TABLE "PointsLedger" DROP CONSTRAINT "domain_PointsLedger_0";
ALTER TABLE "PointsLedger" ADD CONSTRAINT "domain_PointsLedger_0"
  CHECK ((delta <> 0 OR "debtDelta" <> 0) AND "balanceAfter" >= 0 AND "debtAfter" >= 0);
