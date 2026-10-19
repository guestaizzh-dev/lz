ALTER TABLE "CouponTemplate" ADD COLUMN "claimPolicy" text NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "CouponTemplate" ADD CONSTRAINT coupon_claim_policy_valid CHECK ("claimPolicy" IN ('PUBLIC','POINTS'));
-- Existing points offers retain their terms and coupons; only the new distribution field is classified.
UPDATE "CouponTemplate" c SET "claimPolicy"='POINTS'
WHERE EXISTS (SELECT 1 FROM "PointsReward" r WHERE r."couponTemplateId"=c.id);
