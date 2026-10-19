BEGIN;
CREATE TABLE "PromoterProfile" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "userId" text NOT NULL UNIQUE REFERENCES "User"(id),code text NOT NULL UNIQUE,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 statement text NOT NULL,"reviewerId" text REFERENCES "User"(id),"reviewedAt" timestamptz,"proofAssetId" text REFERENCES "MediaAsset"(id),"reviewNote" text);
CREATE TABLE "CourseCommissionRule" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "courseId" text NOT NULL UNIQUE REFERENCES "Course"(id),"rateBasisPoints" int NOT NULL DEFAULT 1000 CHECK("rateBasisPoints" BETWEEN 1 AND 1000),active boolean NOT NULL DEFAULT false);
CREATE TABLE "ReferralOrder" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"orderItemId" text NOT NULL UNIQUE REFERENCES "TradeOrderItem"(id),
 "referralId" text NOT NULL REFERENCES "Referral"(id),"promoterId" text NOT NULL REFERENCES "User"(id),"rateBasisPoints" int NOT NULL CHECK("rateBasisPoints" BETWEEN 1 AND 1000),"approvalSnapshot" jsonb NOT NULL,
 "deliveredAt" timestamptz,"feeVerifiedAt" timestamptz,"feeAmount" bigint CHECK("feeAmount">=0),"feeProofAssetId" text REFERENCES "MediaAsset"(id),"feeReviewerId" text REFERENCES "User"(id));
CREATE INDEX "Referral_buyer_first" ON "Referral"("buyerId","firstValidAt" DESC);
CREATE INDEX "ReferralOrder_promoter" ON "ReferralOrder"("promoterId","createdAt");
CREATE UNIQUE INDEX "CommissionLedger_one_credit" ON "CommissionLedger"("orderItemId") WHERE delta>0;
INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('COMMISSION_EXPENSE','课程推广佣金费用','EXPENSE'),('COMMISSION_PAYABLE','推广佣金待付','LIABILITY'),('COMMISSION_BANK_CLEARING','推广实际银行付款','ASSET') ON CONFLICT(code) DO NOTHING;
COMMIT;
