ALTER TABLE "Resource" DROP CONSTRAINT "domain_Resource_4";
ALTER TABLE "Resource" ADD CONSTRAINT "domain_Resource_4" CHECK ("membershipTier" IS NULL OR "membershipTier" BETWEEN 1 AND 4);

ALTER TABLE "MembershipPlan" DROP CONSTRAINT "domain_MembershipPlan_1";
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "domain_MembershipPlan_1" CHECK ("tier" BETWEEN 1 AND 4 AND "days" IN (30,90,365));

ALTER TABLE "MembershipPlanVersion" DROP CONSTRAINT "domain_MembershipPlanVersion_1";
ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "domain_MembershipPlanVersion_1" CHECK ("tier" BETWEEN 1 AND 4 AND "days">0);

ALTER TABLE "Membership" DROP CONSTRAINT "domain_Membership_0";
ALTER TABLE "Membership" ADD CONSTRAINT "domain_Membership_0" CHECK ("tier" BETWEEN 1 AND 4 AND "endsAt">"startsAt");

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES('CONTENT_ACCESS','会员内容研习','CONTENT','{"contentTier":"integer:0..4"}',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('PRODUCT_DISCOUNT','会员商品折扣','DISCOUNT','{"basisPoints":"integer:1000..10000"}',true),
       ('SHIPPING_WAIVER','会员基础运费减免','SHIPPING','{"minimumSubtotal":"integer:0..100000000"}',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('EVENT_PRIORITY','活动优先报名','PRIORITY','{"enabled":"boolean"}',true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES('FORUM_PIN','论坛置顶申请','QUOTA','{"pinDays":3}',true) ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES ('SIGNED_GIFT','签名书籍与文创领取','QUOTA','{"poolId":"uuid","quota":1}'::jsonb,true) ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES ('STUDY_TOUR_PRIORITY','研学优先报名','PRIORITY','{"enabled":true,"scope":"named-study-tours"}'::jsonb,true) ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('COURSE_DISCOUNT','会员购课立减','DISCOUNT','{"basisPoints":"integer:1000..10000"}',true),
 ('COURSE_EARLY_ACCESS','新课提前研习','PRIORITY','{"enabled":"boolean"}',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('TEACHER_QUESTION','会员专属问答','QUOTA','{"priority":"boolean"}',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('EVENT_DISCOUNT','会员活动免费或优惠','DISCOUNT','{"basisPoints":"integer:0..10000"}',true)
ON CONFLICT(code) DO NOTHING;

INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active) VALUES ('CONSULTATION_CREDIT','会员咨询抵扣','QUOTA','{"amountMinor":"positive minor-unit string"}',true) ON CONFLICT(code) DO NOTHING;

UPDATE "BenefitDefinition" SET "parameterSchema"='{"contentTier":"integer:0..4"}'::jsonb WHERE code='CONTENT_ACCESS';
