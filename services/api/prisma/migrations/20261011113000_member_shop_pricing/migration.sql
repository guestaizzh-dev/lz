ALTER TABLE "Product" ADD COLUMN "memberDiscountEligible" boolean NOT NULL DEFAULT false;
INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('PRODUCT_DISCOUNT','会员商品折扣','DISCOUNT','{"basisPoints":"integer:1000..10000"}',true),
       ('SHIPPING_WAIVER','会员基础运费减免','SHIPPING','{"minimumSubtotal":"integer:0..100000000"}',true)
ON CONFLICT(code) DO NOTHING;
-- Existing purchased versions and product eligibility remain unchanged. Admins publish new terms explicitly.
