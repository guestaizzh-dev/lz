-- Keep the original refund receipt and journal; reversal is a new linked journal.
ALTER TABLE "Refund" DROP CONSTRAINT "domain_Refund_2";
ALTER TABLE "Refund" ADD CONSTRAINT "domain_Refund_2" CHECK("state" IN ('REQUESTED','REVIEW','REJECTED','APPROVED','RETURNING','REFUNDING','SUCCEEDED','FAILED','CANCELLED','REVERSED'));
