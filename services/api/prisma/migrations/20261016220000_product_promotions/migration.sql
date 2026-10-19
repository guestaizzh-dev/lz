BEGIN;
ALTER TABLE "PromotionOffer" ADD COLUMN released int NOT NULL DEFAULT 0 CHECK(released>=0);
ALTER TABLE "PromotionOffer" ADD CONSTRAINT "promotion_capacity_remaining" CHECK(capacity IS NULL OR capacity>=reserved+sold+released);
CREATE INDEX "Promotion_live_window" ON "Promotion"(kind,state,"startsAt","endsAt");
COMMIT;
