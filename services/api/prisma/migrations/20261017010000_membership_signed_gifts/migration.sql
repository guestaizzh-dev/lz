BEGIN;
ALTER TABLE "Event" ADD COLUMN "studyTour" boolean NOT NULL DEFAULT false, ADD COLUMN "studyTourBrief" text NOT NULL DEFAULT '';
CREATE TABLE "MemberGiftPool" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "skuId" text NOT NULL REFERENCES "ProductSku"(id),"offerId" text NOT NULL UNIQUE REFERENCES "SaleOffer"(id),title text NOT NULL,description text NOT NULL,"proofAssetId" text NOT NULL REFERENCES "MediaAsset"(id),"creatorId" text NOT NULL REFERENCES "User"(id),
 capacity int NOT NULL CHECK(capacity>0),allocated int NOT NULL DEFAULT 0,claimed int NOT NULL DEFAULT 0,released int NOT NULL DEFAULT 0,state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','CLOSED')),
 CHECK(allocated>=claimed AND claimed>=0 AND released>=0 AND allocated+released<=capacity));
CREATE TABLE "MemberGiftAllocation" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "poolId" text NOT NULL REFERENCES "MemberGiftPool"(id),"userId" text NOT NULL REFERENCES "User"(id),"sourceKey" text NOT NULL UNIQUE,"orderItemId" text UNIQUE REFERENCES "TradeOrderItem"(id),"membershipId" text UNIQUE REFERENCES "Membership"(id),"expiresAt" timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','AVAILABLE','CLAIMED','RELEASED')));
CREATE INDEX "MemberGiftAllocation_expiry" ON "MemberGiftAllocation"("expiresAt",state);
CREATE TABLE "MemberGiftClaim" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "allocationId" text NOT NULL REFERENCES "MemberGiftAllocation"(id),"userId" text NOT NULL REFERENCES "User"(id),"orderId" text NOT NULL UNIQUE REFERENCES "TradeOrder"(id),"usageId" text NOT NULL UNIQUE REFERENCES "BenefitUsage"(id),"requestKey" text NOT NULL,"requestHash" text NOT NULL,
 state text NOT NULL DEFAULT 'FULFILLING' CHECK(state IN ('FULFILLING','COMPLETED','CANCELLED','RETURN_REQUESTED','RETURN_APPROVED','RETURN_SHIPPED')),
 "returnPreviousState" text,"returnReason" text,"returnInstructionsCipher" text,"returnCarrier" text,"returnTrackingNo" text,"returnProofAssetId" text REFERENCES "MediaAsset"(id),UNIQUE("userId","requestKey"));
CREATE UNIQUE INDEX "MemberGiftClaim_one_active" ON "MemberGiftClaim"("allocationId") WHERE state<>'CANCELLED';
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES ('SIGNED_GIFT','签名书籍与文创领取','QUOTA','{"poolId":"uuid","quota":1}'::jsonb,true) ON CONFLICT(code) DO NOTHING;
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES ('STUDY_TOUR_PRIORITY','研学优先报名','PRIORITY','{"enabled":true,"scope":"named-study-tours"}'::jsonb,true) ON CONFLICT(code) DO NOTHING;
COMMIT;
