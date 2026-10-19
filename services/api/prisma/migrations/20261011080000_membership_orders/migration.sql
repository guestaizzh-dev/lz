-- System posting accounts only; no balances or merchant credentials are fabricated.
INSERT INTO "FinanceAccount" (code,title,kind) VALUES
('MEMBERSHIP_REVENUE','会员套餐收入','REVENUE'),
('MEMBERSHIP_REFUND_PAYABLE','会员异常收款待退款','LIABILITY')
ON CONFLICT(code) DO NOTHING;
CREATE UNIQUE INDEX membership_purchase_item ON "Membership"("orderItemId") WHERE "orderItemId" IS NOT NULL AND source='PURCHASE';
CREATE INDEX membership_sales_order_version ON "TradeOrderItem"("membershipVersionId","orderId");
CREATE UNIQUE INDEX membership_pending_user ON "TradeOrder"("userId") WHERE kind='MEMBERSHIP' AND state='PENDING';
CREATE FUNCTION protect_membership_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source='PURCHASE' AND NOT EXISTS(
    SELECT 1 FROM "TradeOrderItem" i JOIN "TradeOrder" o ON o.id=i."orderId"
    JOIN "PaymentTransaction" p ON p."orderId"=o.id AND p.disposition='ACCEPTED'
    WHERE i.id=NEW."orderItemId" AND o.kind='MEMBERSHIP' AND o."userId"=NEW."userId"
    AND i."membershipVersionId"=NEW."planVersionId" AND NEW."grantKey"='membership.payment:'||p.id
  ) THEN RAISE EXCEPTION 'Purchased membership must originate from its verified payment and frozen version'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_verified_purchase BEFORE INSERT OR UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION protect_membership_purchase();
