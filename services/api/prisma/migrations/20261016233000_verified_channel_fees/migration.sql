INSERT INTO "FinanceAccount"(code,title,kind) VALUES ('CHANNEL_FEE_EXPENSE','核验渠道手续费','EXPENSE') ON CONFLICT(code) DO NOTHING;
