ALTER TABLE "Reconciliation" DROP CONSTRAINT "domain_Reconciliation_0";
CREATE UNIQUE INDEX "Reconciliation_channel_scope_day_hash_key" ON "Reconciliation"(channel,"appScope","businessDay","billHash");
