-- At most one deposit, one commission and one refund ledger row per payment (see schema.prisma).
-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_payment_id_type_key" ON "ledger_entries"("payment_id", "type");
