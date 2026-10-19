ALTER TABLE "Enrollment" ADD COLUMN "startedAt" timestamptz;
CREATE INDEX "course_sales_order_release" ON "TradeOrderItem" ("courseReleaseId", "orderId");
CREATE INDEX "course_sales_refund_order_state" ON "Refund" ("orderId", "state");
INSERT INTO "SaleOffer" ("kind","courseReleaseId","currency","price","active","quantityLimit","policySnapshot")
SELECT 'COURSE',r.id,'CNY',c.price,true,1,jsonb_build_object('title',r.title,'accessDays',r."accessDays",'refundPolicy',r."refundPolicySnapshot",'refundDays',7)
FROM "Course" c JOIN "CourseRelease" r ON r.id=c."publishedReleaseId"
WHERE c.status='PUBLISHED' AND c.format IN ('VIDEO','AUDIO')
AND NOT EXISTS (SELECT 1 FROM "SaleOffer" o WHERE o.kind='COURSE' AND o."courseReleaseId"=r.id);
