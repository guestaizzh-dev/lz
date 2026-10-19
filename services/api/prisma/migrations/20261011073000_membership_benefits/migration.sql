INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES('CONTENT_ACCESS','会员内容研习','CONTENT','{"contentTier":"integer:0..3"}',true)
ON CONFLICT(code) DO NOTHING;
-- This describes the access rule already applied to legacy memberships, without changing their dates or terms.
INSERT INTO "PlanBenefit"("planVersionId","definitionId",parameters,"periodKind")
SELECT v.id,d.id,jsonb_build_object('contentTier',v.tier),'MEMBERSHIP'
FROM "MembershipPlanVersion" v CROSS JOIN "BenefitDefinition" d
WHERE d.code='CONTENT_ACCESS' AND NOT EXISTS(SELECT 1 FROM "PlanBenefit" b WHERE b."planVersionId"=v.id AND b."definitionId"=d.id);

CREATE OR REPLACE FUNCTION domain_plan_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_release integer; snapshot_id text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" AND EXISTS(SELECT 1 FROM "MembershipPlanVersion" v WHERE v.id=NEW."currentVersionId" AND v."planId"=NEW.id AND v.tier=NEW.tier AND v.days=NEW.days AND v.description=NEW.description AND v."termsSnapshot"->>'title'=NEW.title AND (v."termsSnapshot"->>'price')::integer=NEW.price) THEN RETURN NULL; END IF;
    IF (NEW.title,NEW.tier,NEW.days,NEW.description,NEW.price) IS NOT DISTINCT FROM (OLD.title,OLD.tier,OLD.days,OLD.description,OLD.price) THEN RETURN NULL; END IF;
  END IF;
  SELECT COALESCE(max("releaseNo"),0)+1 INTO next_release FROM "MembershipPlanVersion" WHERE "planId"=NEW.id;
  snapshot_id:=gen_random_uuid()::text;
  INSERT INTO "MembershipPlanVersion"(id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
  VALUES(snapshot_id,NEW.id,next_release,NEW.tier,NEW.days,NEW.description,jsonb_build_object('title',NEW.title,'price',NEW.price,'currency','CNY','durationDays',NEW.days,'contentTier',COALESCE((SELECT (b.parameters->>'contentTier')::integer FROM "PlanBenefit" b JOIN "BenefitDefinition" d ON d.id=b."definitionId" WHERE b."planVersionId"=NEW."currentVersionId" AND d.code='CONTENT_ACCESS'),NEW.tier)),now());
  INSERT INTO "PlanBenefit"("planVersionId","definitionId",parameters,quota,"periodKind")
  SELECT snapshot_id,"definitionId",parameters,quota,"periodKind" FROM "PlanBenefit" WHERE "planVersionId"=NEW."currentVersionId";
  INSERT INTO "PlanBenefit"("planVersionId","definitionId",parameters,"periodKind")
  SELECT snapshot_id,id,jsonb_build_object('contentTier',NEW.tier),'MEMBERSHIP' FROM "BenefitDefinition" d WHERE code='CONTENT_ACCESS'
  AND NOT EXISTS(SELECT 1 FROM "PlanBenefit" b WHERE b."planVersionId"=snapshot_id AND b."definitionId"=d.id);
  INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode")
  SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=snapshot_id AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=NEW."currentVersionId";
  UPDATE "MembershipPlan" SET "currentVersionId"=snapshot_id WHERE id=NEW.id;
  RETURN NULL;
END $$;

CREATE FUNCTION protect_membership_benefit_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text;
BEGIN
  IF TG_TABLE_NAME='MembershipPlanVersion' THEN target:=OLD.id;
  ELSIF TG_TABLE_NAME='BenefitScope' THEN SELECT "planVersionId" INTO target FROM "PlanBenefit" WHERE id=COALESCE(NEW."planBenefitId",OLD."planBenefitId");
  ELSE target:=COALESCE(NEW."planVersionId",OLD."planVersionId"); END IF;
  IF TG_OP='UPDATE' OR EXISTS(SELECT 1 FROM "Membership" WHERE "planVersionId"=target)
    OR EXISTS(SELECT 1 FROM "SaleOffer" WHERE "membershipVersionId"=target)
    OR EXISTS(SELECT 1 FROM "MembershipPlan" WHERE "currentVersionId"=target) THEN
    RAISE EXCEPTION 'Published membership benefit terms are immutable';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_version_terms BEFORE UPDATE OR DELETE ON "MembershipPlanVersion" FOR EACH ROW EXECUTE FUNCTION protect_membership_benefit_terms();
CREATE TRIGGER membership_benefit_terms BEFORE INSERT OR UPDATE OR DELETE ON "PlanBenefit" FOR EACH ROW EXECUTE FUNCTION protect_membership_benefit_terms();
CREATE TRIGGER membership_benefit_scope BEFORE INSERT OR UPDATE OR DELETE ON "BenefitScope" FOR EACH ROW EXECUTE FUNCTION protect_membership_benefit_terms();
CREATE OR REPLACE FUNCTION domain_membership_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "MembershipPlan";
BEGIN
  SELECT * INTO p FROM "MembershipPlan" WHERE id=NEW."planId" FOR UPDATE;
  IF p."currentVersionId" IS NULL THEN RAISE EXCEPTION 'Membership plan has no published version'; END IF;
  NEW."planVersionId":=COALESCE(NEW."planVersionId",p."currentVersionId");
  RETURN NEW;
END $$;
CREATE FUNCTION protect_membership_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW."userId",NEW."planId",NEW.tier,NEW."planVersionId",NEW.source,NEW."orderItemId",NEW."grantKey") IS DISTINCT FROM ROW(OLD."userId",OLD."planId",OLD.tier,OLD."planVersionId",OLD.source,OLD."orderItemId",OLD."grantKey") THEN
    RAISE EXCEPTION 'Membership purchase source is immutable';
  END IF;
  IF NEW."planVersionId" IS NULL OR NOT EXISTS(SELECT 1 FROM "MembershipPlanVersion" v WHERE v.id=NEW."planVersionId" AND v."planId"=NEW."planId" AND v.tier=NEW.tier) THEN
    RAISE EXCEPTION 'Membership version must belong to its plan and tier';
  END IF;
  RETURN NEW;
END $$;
-- The existing version-binding BEFORE trigger runs first by its name.
CREATE TRIGGER membership_source_identity BEFORE INSERT OR UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION protect_membership_source();
CREATE FUNCTION protect_benefit_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW."userId",NEW."periodId",NEW."grantId",NEW."definitionId",NEW."windowStart",NEW."windowEnd",NEW.quantity,NEW."businessKey",NEW."parametersSnapshot",NEW."reversalOfId") IS DISTINCT FROM ROW(OLD."userId",OLD."periodId",OLD."grantId",OLD."definitionId",OLD."windowStart",OLD."windowEnd",OLD.quantity,OLD."businessKey",OLD."parametersSnapshot",OLD."reversalOfId")
      OR NEW.state<>OLD.state AND NOT(OLD.state='HELD' AND NEW.state IN ('CONSUMED','RELEASED') OR OLD.state='CONSUMED' AND NEW.state='REVERSED') THEN
      RAISE EXCEPTION 'Benefit usage identity or transition is invalid';
    END IF;
  END IF;
  IF NEW."periodId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "Membership" m JOIN "PlanBenefit" b ON b."planVersionId"=m."planVersionId" WHERE m.id=NEW."periodId" AND m."userId"=NEW."userId" AND b."definitionId"=NEW."definitionId")
    OR NEW."grantId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "BenefitGrant" g WHERE g.id=NEW."grantId" AND g."userId"=NEW."userId" AND g."definitionId"=NEW."definitionId") THEN
    RAISE EXCEPTION 'Benefit usage must belong to its entitlement owner and definition';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_usage_identity BEFORE INSERT OR UPDATE ON "BenefitUsage" FOR EACH ROW EXECUTE FUNCTION protect_benefit_usage();
CREATE INDEX membership_grant_usage_window ON "BenefitUsage"("grantId","definitionId","windowStart",state);
CREATE FUNCTION protect_benefit_grant_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."userId",NEW."definitionId",NEW."growthLedgerId",NEW."redemptionId",NEW."resourceId",NEW."offerId",NEW.source,NEW.quota,NEW."parametersSnapshot",NEW."startsAt",NEW."endsAt",NEW."grantKey") IS DISTINCT FROM ROW(OLD."userId",OLD."definitionId",OLD."growthLedgerId",OLD."redemptionId",OLD."resourceId",OLD."offerId",OLD.source,OLD.quota,OLD."parametersSnapshot",OLD."startsAt",OLD."endsAt",OLD."grantKey") THEN
    RAISE EXCEPTION 'Independent benefit grant source is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER benefit_grant_identity BEFORE UPDATE ON "BenefitGrant" FOR EACH ROW EXECUTE FUNCTION protect_benefit_grant_source();
