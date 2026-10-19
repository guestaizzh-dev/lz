-- These are system posting accounts, not merchant credentials or opening balances.
INSERT INTO "FinanceAccount" (code,title,kind) VALUES
('WECHAT_RECEIVABLE','微信渠道待结算款','ASSET'),
('COURSE_REVENUE','录播课程收入','REVENUE'),
('COURSE_REFUND_PAYABLE','课程异常收款待退款','LIABILITY')
ON CONFLICT (code) DO NOTHING;
