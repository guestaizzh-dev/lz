ALTER TABLE "Refund" ADD COLUMN "returnAddressCipher" text;
INSERT INTO "FinanceAccount" (code,title,kind) VALUES
('PRODUCT_REVENUE','商城商品收入','REVENUE'),
('PRODUCT_REFUND_PAYABLE','商城异常收款待退款','LIABILITY')
ON CONFLICT(code) DO NOTHING;

CREATE INDEX "product_inventory_order_item" ON "InventoryReservation"("orderItemId","state");
CREATE INDEX "product_shipment_order" ON "Shipment"("orderId","kind");

CREATE FUNCTION protect_product_order_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind='PHYSICAL' AND ROW(NEW."orderNo",NEW."userId",NEW.kind,NEW."requestKey",NEW."requestHash",NEW.currency,NEW.subtotal,NEW."discountTotal",NEW."shippingTotal",NEW."payableTotal",NEW."pricingSnapshot",NEW."quoteHash",NEW."expiresAt") IS DISTINCT FROM ROW(OLD."orderNo",OLD."userId",OLD.kind,OLD."requestKey",OLD."requestHash",OLD.currency,OLD.subtotal,OLD."discountTotal",OLD."shippingTotal",OLD."payableTotal",OLD."pricingSnapshot",OLD."quoteHash",OLD."expiresAt") THEN
    RAISE EXCEPTION 'Product purchased order facts are immutable';
  END IF;
  IF OLD.kind='PHYSICAL' AND NEW."addressSnapshotCipher" IS DISTINCT FROM OLD."addressSnapshotCipher" AND NOT (NEW."addressSnapshotCipher" IS NULL AND EXISTS(SELECT 1 FROM "User" WHERE id=OLD."userId" AND status='DELETED')) THEN
    RAISE EXCEPTION 'Product purchased address is immutable except account closure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_order_facts BEFORE UPDATE ON "TradeOrder" FOR EACH ROW EXECUTE FUNCTION protect_product_order_facts();

CREATE FUNCTION protect_product_item_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=OLD."orderId" AND kind='PHYSICAL') AND ROW(NEW."orderId",NEW."lineNo",NEW."offerId",NEW.quantity,NEW."unitPrice",NEW.subtotal,NEW."discountAllocated",NEW."shippingAllocated",NEW.payable,NEW."itemSnapshot") IS DISTINCT FROM ROW(OLD."orderId",OLD."lineNo",OLD."offerId",OLD.quantity,OLD."unitPrice",OLD.subtotal,OLD."discountAllocated",OLD."shippingAllocated",OLD.payable,OLD."itemSnapshot") THEN
    RAISE EXCEPTION 'Product purchased line facts are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER product_item_facts BEFORE UPDATE ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION protect_product_item_facts();
