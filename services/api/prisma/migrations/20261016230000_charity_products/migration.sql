BEGIN;
CREATE TABLE "CharityProgram" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 title text NOT NULL,kind text NOT NULL CHECK(kind IN ('COURSE','MEMBERSHIP')),"releaseId" text REFERENCES "CourseRelease"(id),"membershipVersionId" text REFERENCES "MembershipPlanVersion"(id),price bigint NOT NULL CHECK(price>=0),capacity int NOT NULL CHECK(capacity>0),claimed int NOT NULL DEFAULT 0 CHECK(claimed>=0 AND claimed<=capacity),
 "startsAt" timestamptz NOT NULL,"endsAt" timestamptz NOT NULL CHECK("endsAt">"startsAt"),"qualificationUntil" timestamptz NOT NULL CHECK("qualificationUntil">="endsAt"),"qualificationSummary" text NOT NULL,eligibility text NOT NULL,"qualificationProofId" text NOT NULL REFERENCES "MediaAsset"(id),"contractId" text NOT NULL REFERENCES "PartnerContract"(id),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','ACTIVE','REJECTED','CLOSED')),"creatorId" text NOT NULL REFERENCES "User"(id),"reviewerId" text REFERENCES "User"(id),"reviewedAt" timestamptz,"reviewNote" text,
 CHECK((kind='COURSE' AND "releaseId" IS NOT NULL AND "membershipVersionId" IS NULL) OR (kind='MEMBERSHIP' AND "membershipVersionId" IS NOT NULL AND "releaseId" IS NULL)));
CREATE TABLE "CharityApplication" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "programId" text NOT NULL REFERENCES "CharityProgram"(id),"userId" text NOT NULL REFERENCES "User"(id),"statementCipher" text NOT NULL,state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPROVED','REJECTED','REVOKED')),"reviewerId" text REFERENCES "User"(id),"reviewNote" text,"claimedAt" timestamptz,"grantId" text,UNIQUE("programId","userId"));
CREATE TABLE "CharityOrder" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"orderItemId" text NOT NULL UNIQUE REFERENCES "TradeOrderItem"(id),"applicationId" text NOT NULL REFERENCES "CharityApplication"(id),"programId" text NOT NULL REFERENCES "CharityProgram"(id),"contractId" text NOT NULL REFERENCES "PartnerContract"(id),"termsSnapshot" jsonb NOT NULL,state text NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','DELIVERED','RELEASED','REFUNDED')),"deliveredAt" timestamptz);
CREATE TABLE "CharityRevenue" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"orderItemId" text NOT NULL REFERENCES "TradeOrderItem"(id),"contractId" text NOT NULL REFERENCES "PartnerContract"(id),"eventKey" text NOT NULL UNIQUE,amount bigint NOT NULL CHECK(amount>0),"rateBasisPoints" int NOT NULL CHECK("rateBasisPoints" BETWEEN 0 AND 10000),delta bigint NOT NULL CHECK(delta<>0),"availableAt" timestamptz NOT NULL,"proofAssetId" text NOT NULL REFERENCES "MediaAsset"(id),"feeAmount" bigint NOT NULL CHECK("feeAmount">=0),"reviewerId" text NOT NULL REFERENCES "User"(id),"reversalOfId" text REFERENCES "CharityRevenue"(id));
CREATE UNIQUE INDEX "CharityOrder_one_live_application" ON "CharityOrder"("applicationId") WHERE state IN ('HELD','DELIVERED');
CREATE INDEX "CharityProgram_current" ON "CharityProgram"(state,"startsAt","endsAt");
CREATE INDEX "CharityApplication_user" ON "CharityApplication"("userId","createdAt" DESC);
INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('CHARITY_PARTNER_PAYABLE','公益合作方待付分成','LIABILITY'),('CHARITY_PARTNER_EXPENSE','公益协议合作分成','EXPENSE'),('CHARITY_BANK_CLEARING','公益合作方实际银行付款','ASSET') ON CONFLICT(code) DO NOTHING;
COMMIT;
