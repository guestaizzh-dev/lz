-- One-time repair for the three inactive, unused plans observed on this deployment.
-- Refuses to change data if names, prices, status, or references have changed.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('membership.plan:0:365',0));
SELECT pg_advisory_xact_lock(hashtextextended('membership.plan:1:365',0));
SELECT pg_advisory_xact_lock(hashtextextended('membership.plan:2:365',0));
SELECT pg_advisory_xact_lock(hashtextextended('membership.plan:3:365',0));
DO $$
DECLARE basic text; bronze text; silver text; actor text; plan_id text; plan_row "MembershipPlan"; current_row "MembershipPlanVersion"; next_id text; next_no integer; content_level integer;
BEGIN
  SELECT id INTO basic FROM "MembershipPlan" WHERE title='会员' AND tier=1 AND days=365 AND price=0 AND NOT active FOR UPDATE;
  SELECT id INTO bronze FROM "MembershipPlan" WHERE title='铜卡会员' AND tier=2 AND days=365 AND price=36500 AND NOT active FOR UPDATE;
  SELECT id INTO silver FROM "MembershipPlan" WHERE title='银卡会员' AND tier=3 AND days=365 AND price=99800 AND NOT active FOR UPDATE;
  IF basic IS NULL OR bronze IS NULL OR silver IS NULL OR EXISTS(SELECT 1 FROM "MembershipPlan" WHERE tier=0 AND days=365) THEN RAISE EXCEPTION 'Membership plans changed; stop and inspect before aligning'; END IF;
  PERFORM id FROM "MembershipPlanVersion" WHERE "planId" IN (basic,bronze,silver) FOR UPDATE;
  IF EXISTS(SELECT 1 FROM "Membership" WHERE "planId" IN (basic,bronze,silver)) OR
     EXISTS(SELECT 1 FROM "TradeOrderItem" i JOIN "MembershipPlanVersion" v ON v.id=i."membershipVersionId" WHERE v."planId" IN (basic,bronze,silver)) OR
     EXISTS(SELECT 1 FROM "SaleOffer" i JOIN "MembershipPlanVersion" v ON v.id=i."membershipVersionId" WHERE v."planId" IN (basic,bronze,silver)) OR
     EXISTS(SELECT 1 FROM "CharityProgram" i JOIN "MembershipPlanVersion" v ON v.id=i."membershipVersionId" WHERE v."planId" IN (basic,bronze,silver)) OR
     EXISTS(SELECT 1 FROM "PlanBenefit" b JOIN "MembershipPlanVersion" v ON v.id=b."planVersionId" JOIN "BenefitDefinition" d ON d.id=b."definitionId" WHERE v."planId" IN (basic,bronze,silver) AND d.code<>'CONTENT_ACCESS')
  THEN RAISE EXCEPTION 'Membership plan has history or extra benefits; stop and inspect'; END IF;
  SELECT id INTO actor FROM "User" WHERE username='admin' AND status='ACTIVE';
  IF actor IS NULL THEN RAISE EXCEPTION 'Admin audit actor unavailable'; END IF;
  UPDATE "MembershipPlan" SET tier=0,title='注册会员',version=version+1,"updatedAt"=now() WHERE id=basic;
  UPDATE "MembershipPlan" SET tier=1,title='铜牌会员',version=version+1,"updatedAt"=now() WHERE id=bronze;
  UPDATE "MembershipPlan" SET tier=2,title='银牌会员',version=version+1,"updatedAt"=now() WHERE id=silver;
  FOREACH plan_id IN ARRAY ARRAY[basic,bronze,silver] LOOP
    SELECT * INTO plan_row FROM "MembershipPlan" WHERE id=plan_id;
    SELECT * INTO current_row FROM "MembershipPlanVersion" WHERE id=plan_row."currentVersionId";
    SELECT LEAST(plan_row.tier,COALESCE((b.parameters->>'contentTier')::integer,plan_row.tier)) INTO content_level FROM "PlanBenefit" b JOIN "BenefitDefinition" d ON d.id=b."definitionId" WHERE b."planVersionId"=current_row.id AND d.code='CONTENT_ACCESS';
    IF content_level IS NULL THEN RAISE EXCEPTION 'Content benefit missing; stop and inspect'; END IF;
    SELECT COALESCE(max("releaseNo"),0)+1 INTO next_no FROM "MembershipPlanVersion" WHERE "planId"=plan_id;
    next_id:=gen_random_uuid()::text;
    INSERT INTO "MembershipPlanVersion"(id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
      VALUES(next_id,plan_id,next_no,plan_row.tier,plan_row.days,plan_row.description,jsonb_set(current_row."termsSnapshot",'{contentTier}',to_jsonb(content_level),true),now());
    INSERT INTO "PlanBenefit"("planVersionId","definitionId",parameters,quota,"periodKind")
      SELECT next_id,b."definitionId",CASE WHEN d.code='CONTENT_ACCESS' THEN jsonb_set(b.parameters,'{contentTier}',to_jsonb(content_level),true) ELSE b.parameters END,b.quota,b."periodKind" FROM "PlanBenefit" b JOIN "BenefitDefinition" d ON d.id=b."definitionId" WHERE b."planVersionId"=current_row.id;
    INSERT INTO "BenefitScope"("planBenefitId","resourceId","offerId","categoryCode")
      SELECT nb.id,s."resourceId",s."offerId",s."categoryCode" FROM "BenefitScope" s JOIN "PlanBenefit" ob ON ob.id=s."planBenefitId" JOIN "PlanBenefit" nb ON nb."planVersionId"=next_id AND nb."definitionId"=ob."definitionId" WHERE ob."planVersionId"=current_row.id;
    UPDATE "MembershipPlan" SET "currentVersionId"=next_id WHERE id=plan_id;
    INSERT INTO "AuditLog"(id,"actorId",action,resource,"resourceId",reason,changes) VALUES(gen_random_uuid()::text,actor,'membership.tier.align','membershipPlan',plan_id,'按五档会员要求整理未售套餐',jsonb_build_object('tier',plan_row.tier,'price',plan_row.price,'previousVersionId',current_row.id,'newVersionId',next_id));
  END LOOP;
END $$;
COMMIT;
