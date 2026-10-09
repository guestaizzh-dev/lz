-- Resource registry is a projection of the existing content identities.
CREATE FUNCTION domain_resource_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb; kind text := TG_ARGV[0]; resource_title text;
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM "Resource" WHERE id=OLD.id; RETURN OLD; END IF;
  j:=to_jsonb(NEW);
  resource_title:=COALESCE(NULLIF(j->>'name',''),NULLIF(j->>'title',''),(SELECT title FROM "Resource" WHERE id=NEW.id),kind);
  INSERT INTO "Resource" (id,kind,title,summary,"publishState",visibility,"categoryCode","isDemo",version,"ownerId")
  VALUES(NEW.id,kind,resource_title,COALESCE(j->>'summary',j->>'bio',''),COALESCE(j->>'status','DRAFT'),COALESCE(j->>'visibility','PUBLIC'),COALESCE(j->>'category',''),COALESCE((j->>'isDemo')::boolean,false),COALESCE((j->>'version')::integer,1),NULLIF(j->>'userId',''))
  ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary,
    "publishState"=CASE WHEN j ? 'status' THEN EXCLUDED."publishState" ELSE "Resource"."publishState" END,
    visibility=CASE WHEN j ? 'visibility' THEN EXCLUDED.visibility ELSE "Resource".visibility END,
    "categoryCode"=CASE WHEN j ? 'category' THEN EXCLUDED."categoryCode" ELSE "Resource"."categoryCode" END,
    "isDemo"=CASE WHEN j ? 'isDemo' THEN EXCLUDED."isDemo" ELSE "Resource"."isDemo" END,
    "updatedAt"=now(),version=EXCLUDED.version;
  RETURN NEW;
END $$;
CREATE TRIGGER domain_article_resource BEFORE INSERT OR UPDATE ON "Article" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('ARTICLE');
CREATE TRIGGER domain_teacher_resource BEFORE INSERT OR UPDATE ON "Teacher" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('TEACHER');
CREATE TRIGGER domain_course_resource BEFORE INSERT OR UPDATE ON "Course" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('COURSE');
CREATE TRIGGER domain_product_resource BEFORE INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('PRODUCT');
CREATE TRIGGER domain_event_resource BEFORE INSERT OR UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('EVENT');
CREATE TRIGGER domain_live_resource BEFORE INSERT OR UPDATE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('LIVE');
CREATE TRIGGER domain_thread_resource BEFORE INSERT OR UPDATE ON "ForumThread" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('THREAD');
CREATE TRIGGER domain_article_resource_delete AFTER DELETE ON "Article" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('ARTICLE');
CREATE TRIGGER domain_teacher_resource_delete AFTER DELETE ON "Teacher" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('TEACHER');
CREATE TRIGGER domain_course_resource_delete AFTER DELETE ON "Course" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('COURSE');
CREATE TRIGGER domain_product_resource_delete AFTER DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('PRODUCT');
CREATE TRIGGER domain_event_resource_delete AFTER DELETE ON "Event" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('EVENT');
CREATE TRIGGER domain_live_resource_delete AFTER DELETE ON "LiveRoom" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('LIVE');
CREATE TRIGGER domain_thread_resource_delete AFTER DELETE ON "ForumThread" FOR EACH ROW EXECUTE FUNCTION domain_resource_sync('THREAD');

CREATE FUNCTION domain_user_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='DELETED' AND NEW."deletedAt" IS NULL THEN NEW."deletedAt":=now(); END IF;
  IF NEW.status<>'DELETED' THEN NEW."deletedAt":=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER domain_user_deleted BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION domain_user_deleted();

CREATE FUNCTION domain_membership_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p "MembershipPlan"; selected_id text;
BEGIN
  SELECT * INTO p FROM "MembershipPlan" WHERE id=NEW."planId" FOR UPDATE;
  SELECT id INTO selected_id FROM "MembershipPlanVersion" WHERE "planId"=p.id ORDER BY "releaseNo" DESC LIMIT 1;
  IF selected_id IS NULL THEN
    selected_id:=gen_random_uuid()::text;
    INSERT INTO "MembershipPlanVersion" (id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
      VALUES(selected_id,p.id,1,p.tier,p.days,p.description,jsonb_build_object('legacyPrice',p.price),now());
    UPDATE "MembershipPlan" SET "currentVersionId"=selected_id WHERE id=p.id;
  END IF;
  NEW."planVersionId":=COALESCE(NEW."planVersionId",selected_id);
  RETURN NEW;
END $$;
CREATE TRIGGER domain_member_version BEFORE INSERT ON "Membership" FOR EACH ROW EXECUTE FUNCTION domain_membership_snapshot();

CREATE FUNCTION domain_role_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb; role_code text; target_user text;
BEGIN
  j:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  SELECT code INTO role_code FROM "AccessRole" WHERE id=j->>'roleId'; target_user:=j->>'userId';
  IF TG_OP<>'DELETE' AND j->>'revokedAt' IS NULL THEN
    UPDATE "User" SET roles=ARRAY(SELECT DISTINCT unnest(roles || ARRAY[role_code::"Role"])) WHERE id=target_user;
  ELSIF NOT EXISTS(SELECT 1 FROM "UserRole" WHERE "userId"=target_user AND "roleId"=j->>'roleId' AND "revokedAt" IS NULL) THEN
    UPDATE "User" SET roles=COALESCE(NULLIF(array_remove(roles,role_code::"Role"),'{}'::"Role"[]),ARRAY['USER']::"Role"[]) WHERE id=target_user;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER domain_role_sync AFTER INSERT OR UPDATE OR DELETE ON "UserRole" FOR EACH ROW EXECUTE FUNCTION domain_role_sync();
ALTER TABLE "AccessRole" ADD CONSTRAINT domain_role_code CHECK(code IN ('USER','TEACHER','OPERATOR','MODERATOR','SUPPORT','FINANCE','ADMIN'));
INSERT INTO "AccessRole"(code,name,"permissionCodes") VALUES
 ('USER','用户','{}'),('TEACHER','老师','{}'),('OPERATOR','运营','{}'),('MODERATOR','审核','{}'),('SUPPORT','客服','{}'),('FINANCE','财务','{}'),('ADMIN','管理员','{}');

CREATE FUNCTION domain_favorite_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN DELETE FROM "Reaction" WHERE "userId"=OLD."userId" AND "resourceId"=OLD."articleId" AND kind='FAVORITE'; RETURN OLD; END IF;
  INSERT INTO "Reaction"("userId","resourceId",kind) VALUES(NEW."userId",NEW."articleId",'FAVORITE') ON CONFLICT("userId","resourceId",kind) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER domain_favorite_sync AFTER INSERT OR DELETE ON "Favorite" FOR EACH ROW EXECUTE FUNCTION domain_favorite_sync();

CREATE FUNCTION domain_reaction_sync() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth()>1 THEN RETURN NULL; END IF;
  IF TG_OP IN ('DELETE','UPDATE') THEN
    IF OLD.kind='FAVORITE' THEN DELETE FROM "Favorite" WHERE "userId"=OLD."userId" AND "articleId"=OLD."resourceId"; END IF;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.kind='FAVORITE' AND EXISTS(SELECT 1 FROM "Article" WHERE id=NEW."resourceId") THEN
    INSERT INTO "Favorite"(id,"userId","articleId") VALUES(gen_random_uuid()::text,NEW."userId",NEW."resourceId") ON CONFLICT("userId","articleId") DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER domain_reaction_sync AFTER INSERT OR UPDATE OR DELETE ON "Reaction" FOR EACH ROW EXECUTE FUNCTION domain_reaction_sync();

CREATE FUNCTION domain_plan_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_release integer; snapshot_id text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (NEW.tier,NEW.days,NEW.description,NEW.price) IS NOT DISTINCT FROM (OLD.tier,OLD.days,OLD.description,OLD.price) THEN RETURN NULL; END IF;
  END IF;
  SELECT COALESCE(max("releaseNo"),0)+1 INTO next_release FROM "MembershipPlanVersion" WHERE "planId"=NEW.id;
  snapshot_id:=gen_random_uuid()::text;
  INSERT INTO "MembershipPlanVersion" (id,"planId","releaseNo",tier,days,description,"termsSnapshot","publishedAt")
    VALUES(snapshot_id,NEW.id,next_release,NEW.tier,NEW.days,NEW.description,jsonb_build_object('legacyPrice',NEW.price),now());
  UPDATE "MembershipPlan" SET "currentVersionId"=snapshot_id WHERE id=NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER domain_plan_snapshot AFTER INSERT OR UPDATE ON "MembershipPlan" FOR EACH ROW EXECUTE FUNCTION domain_plan_snapshot();

-- Preserve the existing SKU cart contract while giving each SKU a canonical offer.
CREATE FUNCTION domain_sku_offer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE product_kind text; product_status text;
BEGIN
  SELECT type::text,status::text INTO product_kind,product_status FROM "Product" WHERE id=NEW."productId";
  IF product_kind='SERVICE' THEN product_kind:='CONSULTATION'; END IF;
  INSERT INTO "SaleOffer" (id,kind,"skuId",price,active,"policySnapshot")
    VALUES('sku-offer-'||NEW.id,product_kind,NEW.id,NEW.price,NEW.active AND product_status='PUBLISHED',jsonb_build_object('source','sku','skuId',NEW.id))
    ON CONFLICT(id) DO UPDATE SET price=EXCLUDED.price,active=EXCLUDED.active,"updatedAt"=now(),version="SaleOffer".version+1;
  RETURN NULL;
END $$;
CREATE TRIGGER domain_sku_offer AFTER INSERT OR UPDATE ON "ProductSku" FOR EACH ROW EXECUTE FUNCTION domain_sku_offer();
CREATE FUNCTION domain_cart_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."offerId" IS NULL OR NEW."offerId"='' THEN NEW."offerId":='sku-offer-'||NEW."skuId"; END IF;
  IF NOT EXISTS(SELECT 1 FROM "SaleOffer" WHERE id=NEW."offerId" AND "skuId"=NEW."skuId") THEN
    RAISE EXCEPTION 'cart offer must belong to SKU' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER domain_cart_offer BEFORE INSERT OR UPDATE ON "CartItem" FOR EACH ROW EXECUTE FUNCTION domain_cart_offer();

CREATE FUNCTION domain_product_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "SaleOffer" SET active=NEW.status='PUBLISHED' AND s.active,"updatedAt"=now(),version="SaleOffer".version+1
    FROM "ProductSku" s WHERE "SaleOffer".id='sku-offer-'||s.id AND s."productId"=NEW.id;
  RETURN NULL;
END $$;
CREATE TRIGGER domain_product_offer AFTER UPDATE OF status ON "Product" FOR EACH ROW EXECUTE FUNCTION domain_product_offer();
