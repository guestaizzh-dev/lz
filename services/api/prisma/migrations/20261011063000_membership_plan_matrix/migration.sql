-- Preserve every existing plan and its historic memberships; add only missing combinations.
CREATE OR REPLACE FUNCTION domain_plan_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_release integer; snapshot_id text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.title,NEW.tier,NEW.days,NEW.description,NEW.price) IS NOT DISTINCT FROM (OLD.title,OLD.tier,OLD.days,OLD.description,OLD.price) THEN RETURN NULL; END IF;
  END IF;
  SELECT COALESCE(max("releaseNo"),0)+1 INTO next_release FROM "MembershipPlanVersion" WHERE "planId"=NEW.id;
  snapshot_id:=gen_random_uuid()::text;
  INSERT INTO "MembershipPlanVersion"(id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
  VALUES(snapshot_id,NEW.id,next_release,NEW.tier,NEW.days,NEW.description,jsonb_build_object('title',NEW.title,'price',NEW.price,'currency','CNY','durationDays',NEW.days,'contentTier',NEW.tier),now());
  UPDATE "MembershipPlan" SET "currentVersionId"=snapshot_id WHERE id=NEW.id;
  RETURN NULL;
END $$;
INSERT INTO "MembershipPlan"(id,title,tier,days,price,description,active)
SELECT gen_random_uuid()::text,t.label||'·'||d.label,t.tier,d.days,
  CASE t.tier WHEN 1 THEN CASE d.days WHEN 30 THEN 1900 WHEN 90 THEN 4900 ELSE 16900 END
  WHEN 2 THEN CASE d.days WHEN 30 THEN 4900 WHEN 90 THEN 12900 ELSE 44900 END
  ELSE CASE d.days WHEN 30 THEN 9900 WHEN 90 THEN 26900 ELSE 89900 END END,
  '有效期'||d.days||'天。可阅读本层级及以下已发布会员文章与课程，以实际会员内容目录为准；独立付费内容、咨询、直播、实物和活动不包含在本基础套餐中。',true
FROM (VALUES(1,'入门会员'),(2,'进阶会员'),(3,'至尊会员')) AS t(tier,label)
CROSS JOIN (VALUES(30,'月卡'),(90,'季卡'),(365,'年卡')) AS d(days,label)
ON CONFLICT(tier,days) DO NOTHING;
