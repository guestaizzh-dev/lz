CREATE TABLE "CommercePartnerRule" (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"contractId" TEXT NOT NULL REFERENCES "PartnerContract"(id),"businessKind" TEXT NOT NULL CHECK("businessKind" IN ('COURSE','MEMBERSHIP','PHYSICAL','DIGITAL','CONSULTATION','EVENT','COHORT')),"resourceId" TEXT,"rateBasisPoints" INTEGER NOT NULL CHECK("rateBasisPoints" BETWEEN 0 AND 10000),"observationDays" INTEGER NOT NULL DEFAULT 15 CHECK("observationDays" BETWEEN 0 AND 365),"startsAt" TIMESTAMPTZ(6) NOT NULL,"endsAt" TIMESTAMPTZ(6) NOT NULL CHECK("endsAt">"startsAt"),enabled BOOLEAN NOT NULL DEFAULT true,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX "CommercePartnerRule_businessKind_resourceId_enabled_idx" ON "CommercePartnerRule"("businessKind","resourceId",enabled);
CREATE TABLE "CommerceFeeEvidence" ("paymentId" TEXT PRIMARY KEY REFERENCES "PaymentTransaction"(id),amount BIGINT NOT NULL CHECK(amount>=0),"proofAssetId" TEXT NOT NULL REFERENCES "MediaAsset"(id),"actorId" TEXT NOT NULL REFERENCES "User"(id),"verifiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now());
CREATE TABLE "CommercePartnerShare" (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),version INTEGER NOT NULL DEFAULT 1,"orderId" TEXT NOT NULL REFERENCES "TradeOrder"(id),"orderItemId" TEXT NOT NULL UNIQUE REFERENCES "TradeOrderItem"(id),"ruleId" TEXT NOT NULL REFERENCES "CommercePartnerRule"(id),"partnerId" TEXT NOT NULL REFERENCES "Partner"(id),"contractId" TEXT NOT NULL REFERENCES "PartnerContract"(id),snapshot JSONB NOT NULL,"accruedAmount" BIGINT NOT NULL DEFAULT 0 CHECK("accruedAmount">=0),"basisAmount" BIGINT NOT NULL DEFAULT 0 CHECK("basisAmount">=0),frozen BOOLEAN NOT NULL DEFAULT true,"availableAt" TIMESTAMP(3),"nextCheckAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),attempts INTEGER NOT NULL DEFAULT 0,"failureCode" TEXT);
CREATE INDEX "CommercePartnerShare_nextCheckAt_idx" ON "CommercePartnerShare"("nextCheckAt");
CREATE INDEX "CommercePartnerShare_partnerId_createdAt_idx" ON "CommercePartnerShare"("partnerId","createdAt");
CREATE TABLE "CommercePartnerRevenue" (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,"createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),"shareId" TEXT NOT NULL REFERENCES "CommercePartnerShare"(id),"orderItemId" TEXT NOT NULL REFERENCES "TradeOrderItem"(id),"partnerId" TEXT NOT NULL REFERENCES "Partner"(id),"contractId" TEXT NOT NULL REFERENCES "PartnerContract"(id),"eventKey" TEXT NOT NULL UNIQUE,delta BIGINT NOT NULL CHECK(delta<>0),"basisSnapshot" JSONB NOT NULL,"availableAt" TIMESTAMPTZ(6) NOT NULL,"settlementId" TEXT REFERENCES "Settlement"(id));
CREATE INDEX "CommercePartnerRevenue_partnerId_settlementId_availableAt_idx" ON "CommercePartnerRevenue"("partnerId","settlementId","availableAt");
CREATE FUNCTION freeze_commerce_partner_share() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o "TradeOrder"; offer "SaleOffer"; rule "CommercePartnerRule"; resource TEXT; partner TEXT;
BEGIN
 SELECT * INTO o FROM "TradeOrder" WHERE id=NEW."orderId";
 SELECT * INTO offer FROM "SaleOffer" WHERE id=NEW."offerId";
 IF o.kind='COURSE' THEN SELECT "courseId" INTO resource FROM "CourseRelease" WHERE id=COALESCE(NEW."courseReleaseId",offer."courseReleaseId");
 ELSIF o.kind IN ('PHYSICAL','DIGITAL') THEN SELECT "productId" INTO resource FROM "ProductSku" WHERE id=offer."skuId";
 ELSIF o.kind='MEMBERSHIP' THEN SELECT "planId" INTO resource FROM "MembershipPlanVersion" WHERE id=COALESCE(NEW."membershipVersionId",offer."membershipVersionId");
 ELSIF o.kind='CONSULTATION' THEN resource:=offer."serviceOfferingId";
 ELSIF o.kind='EVENT' THEN SELECT s."eventId" INTO resource FROM "EventTicketType" t JOIN "EventSession" s ON s.id=t."sessionId" WHERE t.id=offer."eventTicketId";
 ELSIF o.kind='COHORT' THEN resource:=offer."cohortId";
 ELSE RETURN NEW; END IF;
 SELECT r.* INTO rule FROM "CommercePartnerRule" r JOIN "PartnerContract" c ON c.id=r."contractId" JOIN "Partner" p ON p.id=c."partnerId" WHERE r."businessKind"=o.kind AND (r."resourceId"=resource OR r."resourceId" IS NULL) AND r.enabled AND p.status='ACTIVE' AND r."startsAt"<=o."createdAt" AND r."endsAt">o."createdAt" ORDER BY r."resourceId" NULLS LAST,r."createdAt" DESC,r.id DESC LIMIT 1;
 IF rule.id IS NULL THEN RETURN NEW; END IF;
 SELECT "partnerId" INTO partner FROM "PartnerContract" WHERE id=rule."contractId";
 INSERT INTO "CommercePartnerShare" ("orderId","orderItemId","ruleId","partnerId","contractId",snapshot) VALUES(o.id,NEW.id,rule.id,partner,rule."contractId",jsonb_build_object('businessKind',o.kind,'resourceId',resource,'rateBasisPoints',rule."rateBasisPoints",'observationDays',rule."observationDays",'startsAt',rule."startsAt",'endsAt',rule."endsAt",'basis','实际已确认净收入减已核验渠道费用；含运费，以本合同约定为准'));
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_commerce_partner_share AFTER INSERT ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION freeze_commerce_partner_share();
INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('COMMERCE_PARTNER_EXPENSE','合作方分成费用','EXPENSE'),('COMMERCE_PARTNER_PAYABLE','合作方分成应付','LIABILITY'),('COMMERCE_PARTNER_BANK','合作方实际银行付款','ASSET') ON CONFLICT(code) DO NOTHING;
