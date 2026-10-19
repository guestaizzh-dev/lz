INSERT INTO "BenefitDefinition"(code,name,kind,"parameterSchema",active)
VALUES ('EVENT_DISCOUNT','会员活动免费或优惠','DISCOUNT','{"basisPoints":"integer:0..10000"}',true)
ON CONFLICT(code) DO NOTHING;
-- Zero means a genuine membership price benefit, not a fabricated payment.
-- Existing plan versions, tickets, quotes and orders are not rewritten.
