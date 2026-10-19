ALTER TABLE "Course" ADD COLUMN "memberDiscountEligible" boolean NOT NULL DEFAULT false,
 ADD COLUMN "earlyAccessAt" timestamptz, ADD COLUMN "publicOpenAt" timestamptz,
 ADD CONSTRAINT course_learning_window CHECK (("earlyAccessAt" IS NULL AND "publicOpenAt" IS NULL) OR ("earlyAccessAt" IS NOT NULL AND "publicOpenAt" IS NOT NULL AND "earlyAccessAt"<"publicOpenAt" AND format IN ('VIDEO','AUDIO') AND "membershipTier" IS NOT NULL));
ALTER TABLE "CourseRelease" ADD COLUMN "memberPolicySnapshot" jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION course_member_policy_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."memberPolicySnapshot" IS DISTINCT FROM OLD."memberPolicySnapshot" THEN RAISE EXCEPTION 'Published course member policy is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER course_member_policy_frozen BEFORE UPDATE ON "CourseRelease" FOR EACH ROW EXECUTE FUNCTION course_member_policy_frozen();
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('COURSE_DISCOUNT','会员购课立减','DISCOUNT','{"basisPoints":"integer:1000..10000"}',true),
 ('COURSE_EARLY_ACCESS','新课提前研习','PRIORITY','{"enabled":"boolean"}',true)
ON CONFLICT(code) DO NOTHING;
-- Do not rewrite purchased plans, released courses or existing orders.
