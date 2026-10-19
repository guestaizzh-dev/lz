-- Preserve existing marketing and community facts; new opt-in workflows only.
CREATE TABLE "ForumPinApplication" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "userId" text NOT NULL REFERENCES "User"(id),"threadId" text NOT NULL REFERENCES "ForumThread"(id),"requestKey" text NOT NULL,"usageId" text NOT NULL UNIQUE REFERENCES "BenefitUsage"(id),state text NOT NULL CHECK(state IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
 "pinDays" int NOT NULL CHECK("pinDays" BETWEEN 1 AND 7),"reviewerId" text REFERENCES "User"(id),"reviewNote" text,"pinnedUntil" timestamptz,UNIQUE("userId","requestKey")
);
CREATE INDEX "ForumPinApplication_state_createdAt_idx" ON "ForumPinApplication"(state,"createdAt");
CREATE UNIQUE INDEX "ForumPinApplication_pending_thread" ON "ForumPinApplication"("threadId") WHERE state='PENDING';
CREATE TABLE "CourseCase" (
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" timestamptz NOT NULL DEFAULT now(),"updatedAt" timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 "authorizationId" text NOT NULL UNIQUE REFERENCES "ContentAuthorization"(id),"userId" text NOT NULL REFERENCES "User"(id),"releaseId" text NOT NULL REFERENCES "CourseRelease"(id),title text NOT NULL,"textCipher" text NOT NULL,state text NOT NULL CHECK(state IN ('SUBMITTED','COMMENTED','PUBLISHED','REJECTED','WITHDRAWN')),
 "teacherId" text REFERENCES "User"(id),"teacherComment" text,"reviewerId" text REFERENCES "User"(id),"reviewNote" text,"requestKey" text NOT NULL,"publishedAt" timestamptz,"withdrawnAt" timestamptz,UNIQUE("userId","requestKey")
);
CREATE INDEX "CourseCase_releaseId_state_idx" ON "CourseCase"("releaseId",state);
ALTER TABLE "CampaignEntry" ADD COLUMN "featuredFrom" timestamptz,ADD COLUMN "featuredUntil" timestamptz,ADD COLUMN "qualityScore" int CHECK("qualityScore" BETWEEN 0 AND 100);
ALTER TABLE "CampaignEntry" ADD CHECK ("featuredUntil" IS NULL OR "featuredUntil">"featuredFrom");
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES('FORUM_PIN','论坛置顶申请','QUOTA','{"pinDays":3}',true) ON CONFLICT(code) DO NOTHING;
CREATE INDEX "ConsentRecord_recommendation_lookup" ON "ConsentRecord"("userId","policyCode","actedAt" DESC);
CREATE UNIQUE INDEX "UserCoupon_locked_order" ON "UserCoupon"("lockedOrderId") WHERE "lockedOrderId" IS NOT NULL;
