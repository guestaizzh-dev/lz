INSERT INTO "FinanceAccount" (code,title,kind) VALUES
('BOOKING_REVENUE','预约活动服务收入','REVENUE'),
('BOOKING_ADVANCE','预约活动待履约预收款','LIABILITY'),
('BOOKING_REFUND_PAYABLE','预约活动异常收款待退款','LIABILITY') ON CONFLICT (code) DO NOTHING;
CREATE INDEX "booking_orders_user_state" ON "TradeOrder" ("userId",state,"createdAt") WHERE kind IN ('CONSULTATION','EVENT');
CREATE INDEX "booking_reservation_resource" ON "InventoryReservation" ("slotId","eventTicketId",state);
CREATE UNIQUE INDEX "booking_one_reservation_per_item" ON "InventoryReservation" ("orderItemId") WHERE "slotId" IS NOT NULL OR "eventTicketId" IS NOT NULL;
CREATE FUNCTION protect_booking_order_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM "TradeOrder" WHERE id=OLD."orderId" AND kind IN ('CONSULTATION','EVENT')) AND
    (NEW."itemSnapshot",NEW."offerId",NEW."slotId",NEW.quantity,NEW."unitPrice",NEW.subtotal,NEW.payable,NEW."benefitSnapshot",NEW."orderId") IS DISTINCT FROM
    (OLD."itemSnapshot",OLD."offerId",OLD."slotId",OLD.quantity,OLD."unitPrice",OLD.subtotal,OLD.payable,OLD."benefitSnapshot",OLD."orderId") THEN
    RAISE EXCEPTION 'Booking purchase snapshot is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "booking_order_snapshot" BEFORE UPDATE ON "TradeOrderItem" FOR EACH ROW EXECUTE FUNCTION protect_booking_order_snapshot();
