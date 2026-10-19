-- Preserve the existing cohort offer invariant when extending offers for gift packs.
ALTER TABLE "SaleOffer" DROP CONSTRAINT "domain_SaleOffer_1";
ALTER TABLE "SaleOffer" ADD CONSTRAINT "domain_SaleOffer_1" CHECK(
  num_nonnulls("courseReleaseId","cohortId","skuId","membershipVersionId","serviceOfferingId","eventTicketId","giftId","operatingServiceId","giftPackId")=1
  AND (kind='COHORT')=("cohortId" IS NOT NULL)
  AND ("giftPackId" IS NULL OR kind='GIFT')
);
