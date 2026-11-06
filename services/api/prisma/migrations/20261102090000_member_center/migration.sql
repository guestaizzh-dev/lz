BEGIN;
CREATE TABLE "MembershipGrade" (
 tier INTEGER PRIMARY KEY CHECK(tier BETWEEN 1 AND 4), title TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 100000000),
 "voucherQuantity" INTEGER NOT NULL CHECK("voucherQuantity" BETWEEN 0 AND 100000),
 "goodsBasisPoints" INTEGER NOT NULL CHECK("goodsBasisPoints" BETWEEN 1000 AND 10000),
 "bookBasisPoints" INTEGER NOT NULL CHECK("bookBasisPoints" BETWEEN 1000 AND 10000),
 active BOOLEAN NOT NULL DEFAULT true, version INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO "MembershipGrade"(tier,title,price,"voucherQuantity","goodsBasisPoints","bookBasisPoints") VALUES
 (1,'铜牌会员',36500,50,9500,9900),(2,'银牌会员',99800,100,9000,9800),
 (3,'金牌会员',168000,200,8500,9700),(4,'钻石会员',298000,300,8000,9600);
CREATE TABLE "MemberPurchase" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "userId" TEXT NOT NULL REFERENCES "User"(id),
 "orderId" TEXT NOT NULL UNIQUE REFERENCES "TradeOrder"(id),
 "previousId" TEXT REFERENCES "MemberPurchase"(id), tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 4),
 "priceCredit" INTEGER NOT NULL CHECK("priceCredit">0), "giftTarget" INTEGER NOT NULL CHECK("giftTarget">=0),
 "goodsBasisPoints" INTEGER NOT NULL, "bookBasisPoints" INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','SUPERSEDED','REFUND_HELD','REVOKED')),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "MemberPurchase_userId_state_idx" ON "MemberPurchase"("userId",state);
CREATE UNIQUE INDEX member_center_active_user ON "MemberPurchase"("userId") WHERE state IN ('ACTIVE','REFUND_HELD');
CREATE TABLE "VideoVoucherLot" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "userId" TEXT NOT NULL REFERENCES "User"(id),
 "orderId" TEXT NOT NULL UNIQUE REFERENCES "TradeOrder"(id),
 "memberPurchaseId" TEXT UNIQUE REFERENCES "MemberPurchase"(id),
 quantity INTEGER NOT NULL CHECK(quantity>0), remaining INTEGER NOT NULL CHECK(remaining>=0),
 held INTEGER NOT NULL DEFAULT 0 CHECK(held>=0), used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),
 refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded>=0), "refundHeld" INTEGER NOT NULL DEFAULT 0 CHECK("refundHeld">=0),
 suspended BOOLEAN NOT NULL DEFAULT false, source TEXT NOT NULL CHECK(source IN ('MEMBERSHIP','PURCHASE')),
 "unitPrice" INTEGER NOT NULL DEFAULT 0 CHECK("unitPrice">=0), "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(quantity=remaining+held+used+refunded+"refundHeld")
);
CREATE INDEX "VideoVoucherLot_userId_suspended_createdAt_idx" ON "VideoVoucherLot"("userId",suspended,"createdAt");
CREATE TABLE "VideoVoucherAllocation" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "lotId" TEXT NOT NULL REFERENCES "VideoVoucherLot"(id),
 "orderId" TEXT NOT NULL REFERENCES "TradeOrder"(id), quantity INTEGER NOT NULL CHECK(quantity>0),
 state TEXT NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','CONSUMED','RELEASED','RETURNED')), UNIQUE("lotId","orderId")
);
CREATE INDEX "VideoVoucherAllocation_orderId_state_idx" ON "VideoVoucherAllocation"("orderId",state);
CREATE TABLE "MemberDiscountUse" (
 id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, "memberPurchaseId" TEXT NOT NULL REFERENCES "MemberPurchase"(id),
 "orderId" TEXT NOT NULL REFERENCES "TradeOrder"(id), state TEXT NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','CONSUMED','RELEASED','RETURNED')),
 UNIQUE("memberPurchaseId","orderId")
);
CREATE INDEX "MemberDiscountUse_orderId_state_idx" ON "MemberDiscountUse"("orderId",state);
ALTER TABLE "TradeOrder" DROP CONSTRAINT "domain_TradeOrder_4";
ALTER TABLE "TradeOrder" ADD CONSTRAINT "domain_TradeOrder_4" CHECK(kind IN ('COURSE','COHORT','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE','MEMBER_LIFETIME','VIDEO_VOUCHER'));
ALTER TABLE "SaleOffer" DROP CONSTRAINT "domain_SaleOffer_0";
ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_0" CHECK(kind IN ('COURSE','COHORT','PHYSICAL','DIGITAL','MEMBERSHIP','CONSULTATION','EVENT','GIFT','OPERATING_SERVICE','MEMBER_LIFETIME','VIDEO_VOUCHER'));
INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('VIDEO_VOUCHER_LIABILITY','已售视频代金券待履约','LIABILITY') ON CONFLICT(code) DO NOTHING;

ALTER TABLE "SaleOffer" DROP CONSTRAINT "domain_SaleOffer_1";
ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_1" CHECK(
 (kind IN ('MEMBER_LIFETIME','VIDEO_VOUCHER') AND num_nonnulls("courseReleaseId","cohortId","skuId","membershipVersionId","serviceOfferingId","eventTicketId","giftId","operatingServiceId","giftPackId")=0)
 OR (kind NOT IN ('MEMBER_LIFETIME','VIDEO_VOUCHER') AND num_nonnulls("courseReleaseId","cohortId","skuId","membershipVersionId","serviceOfferingId","eventTicketId","giftId","operatingServiceId","giftPackId")=1 AND (kind='COHORT')=("cohortId" IS NOT NULL) AND ("giftPackId" IS NULL OR kind='GIFT'))
);

ALTER TABLE "Product" ADD COLUMN "membershipPriceCategory" TEXT NOT NULL DEFAULT 'LIFESTYLE' CHECK("membershipPriceCategory" IN ('LIFESTYLE','BOOK'));
UPDATE "Product" SET "membershipPriceCategory"='BOOK' WHERE category IN ('图书','经典典籍','图书典籍');
CREATE FUNCTION protect_center_member_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM "TradeOrder" o JOIN "PaymentTransaction" p ON p."orderId"=o.id WHERE o.id=NEW."orderId" AND o."userId"=NEW."userId" AND o.kind='MEMBER_LIFETIME' AND p.disposition='ACCEPTED') THEN RAISE EXCEPTION 'Long term membership requires its verified receipt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER center_member_verified BEFORE INSERT ON "MemberPurchase" FOR EACH ROW EXECUTE FUNCTION protect_center_member_purchase();
CREATE FUNCTION protect_voucher_enrollment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source='VOUCHER' AND NOT EXISTS(SELECT 1 FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId" JOIN "VideoVoucherAllocation" a ON a."orderId"=o.id JOIN "CourseRelease" r ON r.id=i."courseReleaseId" WHERE i.id=NEW."orderItemId" AND o."userId"=NEW."userId" AND o.kind='COURSE' AND o."payableTotal"=0 AND (a.state='CONSUMED' OR NEW."revokedAt" IS NOT NULL AND a.state='RETURNED') AND a.quantity>0 AND r.id=NEW."releaseId" AND NEW."grantKey"='course.voucher:'||o.id) THEN RAISE EXCEPTION 'Voucher enrollment requires its consumed voucher order'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER voucher_enrollment_verified BEFORE INSERT OR UPDATE ON "Enrollment" FOR EACH ROW EXECUTE FUNCTION protect_voucher_enrollment();

COMMIT;
