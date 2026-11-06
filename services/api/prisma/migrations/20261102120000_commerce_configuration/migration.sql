BEGIN;
ALTER TABLE "CatalogCategory" DROP CONSTRAINT "CatalogCategory_scope_check";
ALTER TABLE "CatalogCategory" ADD CONSTRAINT "CatalogCategory_scope_check" CHECK(scope IN ('ARTICLE','COURSE','PRODUCT','EVENT','MALL'));
INSERT INTO "CatalogCategory" (scope,code,label,position) VALUES
 ('MALL','LIFESTYLE','生活馆商品',10),('MALL','VIDEO','课件视频',20),('MALL','BOOK','图书',30);
CREATE TABLE "VideoVoucherPolicy" (
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
 title TEXT NOT NULL DEFAULT '视频代金券',
 price INTEGER NOT NULL DEFAULT 300 CHECK(price BETWEEN 1 AND 1000000),
 "faceValue" INTEGER NOT NULL DEFAULT 300 CHECK("faceValue" BETWEEN 1 AND 1000000),
 active BOOLEAN NOT NULL DEFAULT true,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
 CHECK(price<="faceValue")
);
INSERT INTO "VideoVoucherPolicy"(id) VALUES(1);
ALTER TABLE "VideoVoucherLot" ADD COLUMN "faceValue" INTEGER NOT NULL DEFAULT 300 CHECK("faceValue" BETWEEN 1 AND 1000000);
CREATE FUNCTION preserve_video_voucher_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."faceValue"<>OLD."faceValue" OR NEW."unitPrice"<>OLD."unitPrice" OR NEW.source<>OLD.source OR NEW."userId"<>OLD."userId" OR NEW."orderId"<>OLD."orderId" OR NEW.quantity<>OLD.quantity THEN
  RAISE EXCEPTION 'Issued video voucher terms are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER video_voucher_terms_immutable BEFORE UPDATE ON "VideoVoucherLot" FOR EACH ROW EXECUTE FUNCTION preserve_video_voucher_terms();
ALTER TABLE "Product" ADD COLUMN "mallCategory" TEXT CHECK("mallCategory" IN ('LIFESTYLE','VIDEO','BOOK'));
UPDATE "Product" SET "mallCategory"="membershipPriceCategory" WHERE type='PHYSICAL';
UPDATE "Product" p SET "mallCategory"='VIDEO' WHERE type='DIGITAL' AND EXISTS(
 SELECT 1 FROM "DigitalRelease" r JOIN "DigitalReleaseAsset" l ON l."releaseId"=r.id JOIN "MediaAsset" a ON a.id=l."assetId" WHERE r."productId"=p.id AND a.mime LIKE 'video/%');
UPDATE "Product" SET "mallCategory"='LIFESTYLE' WHERE "mallCategory" IS NULL;
ALTER TABLE "Product" ALTER COLUMN "mallCategory" SET DEFAULT 'LIFESTYLE';
ALTER TABLE "Product" ALTER COLUMN "mallCategory" SET NOT NULL;
CREATE INDEX "Product_mallCategory_status_idx" ON "Product"("mallCategory",status);
COMMIT;
