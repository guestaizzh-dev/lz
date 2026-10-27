-- A legacy free plan may be retained for history; registration itself needs no purchase or expiry.
ALTER TABLE "MembershipPlan" DROP CONSTRAINT "domain_MembershipPlan_1";
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "domain_MembershipPlan_1" CHECK ("tier" BETWEEN 0 AND 4 AND "days" IN (30,90,365));
ALTER TABLE "MembershipPlanVersion" DROP CONSTRAINT "domain_MembershipPlanVersion_1";
ALTER TABLE "MembershipPlanVersion" ADD CONSTRAINT "domain_MembershipPlanVersion_1" CHECK ("tier" BETWEEN 0 AND 4 AND "days">0);
