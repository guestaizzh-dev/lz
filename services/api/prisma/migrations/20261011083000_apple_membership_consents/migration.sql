-- Reuse TradeOrder and PaymentAttempt as persistent, attributable purchase consent.
-- No member, purchase, receipt or financial sample is inserted by this migration.
CREATE INDEX apple_membership_attempt_mapping ON "PaymentAttempt"("mappingId","orderId") WHERE channel='APPLE_IAP';
CREATE FUNCTION protect_apple_membership_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='TradeOrder' THEN
    IF OLD.kind='MEMBERSHIP' AND OLD."pricingSnapshot"->>'channel'='APPLE_IAP' AND
      ROW(NEW."userId",NEW.kind,NEW."requestKey",NEW."requestHash",NEW.currency,NEW.subtotal,NEW."payableTotal",NEW."pricingSnapshot",NEW."quoteHash",NEW."createdAt",NEW."expiresAt") IS DISTINCT FROM
      ROW(OLD."userId",OLD.kind,OLD."requestKey",OLD."requestHash",OLD.currency,OLD.subtotal,OLD."payableTotal",OLD."pricingSnapshot",OLD."quoteHash",OLD."createdAt",OLD."expiresAt") THEN
      RAISE EXCEPTION 'Apple membership purchase consent is immutable';
    END IF;
  ELSIF TG_TABLE_NAME='TradeOrderItem' THEN
    IF EXISTS(SELECT 1 FROM "TradeOrder" o WHERE o.id=OLD."orderId" AND o.kind='MEMBERSHIP' AND o."pricingSnapshot"->>'channel'='APPLE_IAP') AND
      ROW(NEW."orderId",NEW."offerId",NEW.quantity,NEW."unitPrice",NEW.subtotal,NEW.payable,NEW."membershipVersionId",NEW."itemSnapshot",NEW."benefitSnapshot") IS DISTINCT FROM
      ROW(OLD."orderId",OLD."offerId",OLD.quantity,OLD."unitPrice",OLD.subtotal,OLD.payable,OLD."membershipVersionId",OLD."itemSnapshot",OLD."benefitSnapshot") THEN
      RAISE EXCEPTION 'Apple membership purchased terms are immutable';
    END IF;
  ELSIF TG_TABLE_NAME='SaleOffer' THEN
    IF EXISTS(SELECT 1 FROM "ChannelProductMapping" m WHERE m."offerId"=OLD.id AND m.channel='APPLE_IAP') AND
      ROW(NEW.kind,NEW."membershipVersionId",NEW."courseReleaseId",NEW.currency,NEW.price,NEW."policySnapshot",NEW."validFrom",NEW."validUntil") IS DISTINCT FROM
      ROW(OLD.kind,OLD."membershipVersionId",OLD."courseReleaseId",OLD.currency,OLD.price,OLD."policySnapshot",OLD."validFrom",OLD."validUntil") THEN
      RAISE EXCEPTION 'Apple mapped offer identity and price are immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER apple_membership_order_consent BEFORE UPDATE ON "TradeOrder" FOR EACH ROW EXECUTE FUNCTION protect_apple_membership_consent();
CREATE TRIGGER apple_membership_item_consent BEFORE UPDATE ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION protect_apple_membership_consent();
CREATE TRIGGER apple_mapped_offer_identity BEFORE UPDATE ON "SaleOffer" FOR EACH ROW EXECUTE FUNCTION protect_apple_membership_consent();
