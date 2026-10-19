-- Posting account only; no merchant identity or opening balance is fabricated.
INSERT INTO "FinanceAccount" (code,title,kind) VALUES
('ALIPAY_RECEIVABLE','支付宝渠道待结算款','ASSET')
ON CONFLICT (code) DO NOTHING;
