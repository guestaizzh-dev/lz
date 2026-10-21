CREATE TABLE "CatalogCategory" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  scope TEXT NOT NULL CHECK (scope IN ('ARTICLE','COURSE','PRODUCT','EVENT')),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  version INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "CatalogCategory_scope_code_key" ON "CatalogCategory"(scope,code);
CREATE UNIQUE INDEX "CatalogCategory_scope_label_key" ON "CatalogCategory"(scope,label);
INSERT INTO "CatalogCategory" (scope,code,label,position)
SELECT scope,code,code,position FROM (VALUES
 ('ARTICLE','经典原文',10),('ARTICLE','名师解读',20),('ARTICLE','实践心得',30),('ARTICLE','道学常识',40),
 ('COURSE','经典研习',10),('COURSE','实践修行',20),('COURSE','生活应用',30),('COURSE','少儿启蒙',40),
 ('PRODUCT','经典典籍',10),('PRODUCT','文创',20),('PRODUCT','养生用品',30),('PRODUCT','修行工具',40),('PRODUCT','线下服务',50),
 ('EVENT','线下活动',10),('EVENT','研学活动',20)
) AS defaults(scope,code,position);
INSERT INTO "CatalogCategory" (scope,code,label,position)
SELECT scope,category,category,100 FROM (
 SELECT 'ARTICLE' AS scope,category FROM "Article" UNION SELECT 'COURSE',category FROM "Course"
 UNION SELECT 'PRODUCT',category FROM "Product" UNION SELECT 'EVENT',category FROM "Event"
) AS existing WHERE category<>'' ON CONFLICT DO NOTHING;

-- A single administrator can confirm delivery; ordinary roles retain separation.
DO $$ DECLARE constraint_row record; BEGIN
 FOR constraint_row IN SELECT conname FROM pg_constraint WHERE conrelid='"ServiceDelivery"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%reviewerId%' AND pg_get_constraintdef(oid) LIKE '%proposerId%' LOOP
   EXECUTE format('ALTER TABLE "ServiceDelivery" DROP CONSTRAINT %I',constraint_row.conname);
 END LOOP;
END $$;
ALTER TABLE "ServiceDelivery" ADD CONSTRAINT service_delivery_review_state CHECK (
 (state='PENDING' AND "reviewerId" IS NULL AND "reviewedAt" IS NULL) OR
 (state<>'PENDING' AND "reviewerId" IS NOT NULL AND "reviewedAt" IS NOT NULL)
);
ALTER TABLE "ServiceDelivery" ALTER COLUMN "proofAssetId" DROP NOT NULL;
ALTER TABLE "ServiceDelivery" ALTER COLUMN "proofHash" DROP NOT NULL;
CREATE OR REPLACE FUNCTION validate_service_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId" WHERE i.id=NEW."orderItemId" AND o.id=NEW."orderId" AND o.kind IN ('CONSULTATION','EVENT','COHORT')) THEN
  RAISE EXCEPTION 'Service delivery must belong to its paid service order';
 END IF;
 IF NEW."reviewerId"=NEW."proposerId" AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=NEW."reviewerId" AND u.status='ACTIVE' AND 'ADMIN'=ANY(u.roles)) THEN
  RAISE EXCEPTION 'Only an administrator may confirm their own delivery';
 END IF;
 IF NEW."proofAssetId" IS NULL AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=NEW."proposerId" AND u.status='ACTIVE' AND 'ADMIN'=ANY(u.roles)) THEN
  RAISE EXCEPTION 'Non-admin delivery requires attachment';
 END IF;
 IF NEW.version<1 OR NEW."proofHash" IS NOT NULL AND NEW."proofHash" !~ '^[a-f0-9]{64}$' OR NEW."requestHash" !~ '^[a-f0-9]{64}$' OR ((NEW."proofAssetId" IS NULL)<>(NEW."proofHash" IS NULL)) THEN RAISE EXCEPTION 'Invalid service delivery revision or evidence hash'; END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE constraint_row record; BEGIN
 FOR constraint_row IN SELECT conname FROM pg_constraint WHERE conrelid='"AppleRefundReview"'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%reviewedBy%' AND pg_get_constraintdef(oid) LIKE '%submittedBy%' LOOP
   EXECUTE format('ALTER TABLE "AppleRefundReview" DROP CONSTRAINT %I',constraint_row.conname);
 END LOOP;
END $$;
ALTER TABLE "AppleRefundReview" ADD CONSTRAINT apple_refund_review_state CHECK (
 (state='PENDING' AND "reviewedBy" IS NULL AND "reviewedAt" IS NULL AND "refundId" IS NULL) OR
 (state IN ('CONFIRMED','REJECTED') AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL AND length("reviewNote")>=2 AND ((state='CONFIRMED' AND "refundId" IS NOT NULL) OR (state='REJECTED' AND "refundId" IS NULL)))
);
CREATE FUNCTION validate_single_admin_apple_review() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.state='CONFIRMED' AND NEW."reviewedBy"=NEW."submittedBy" AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=NEW."reviewedBy" AND u.status='ACTIVE' AND 'ADMIN'=ANY(u.roles)) THEN RAISE EXCEPTION 'Only administrator may confirm own Apple refund evidence'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER single_admin_apple_review BEFORE INSERT OR UPDATE ON "AppleRefundReview" FOR EACH ROW EXECUTE FUNCTION validate_single_admin_apple_review();
