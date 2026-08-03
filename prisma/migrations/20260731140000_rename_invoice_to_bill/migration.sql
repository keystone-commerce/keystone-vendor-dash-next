-- Rename Invoice -> Bill throughout the database.
--
-- The dashboard tracks the procurement side: an approved PO is converted to a **Bill**
-- in Zoho Books (money we owe a supplier), which then syncs back here. "Invoice" was
-- the wrong word — in Zoho that means the sales side, what customers owe us — so the
-- naming was actively misleading to anyone reading the schema or the Zoho account.
--
-- Uses ALTER ... RENAME throughout rather than drop/recreate, so existing rows, keys,
-- indexes and foreign keys are preserved. Written to be safe if partially applied.

-- ── enum ─────────────────────────────────────────────────────────────────────────
ALTER TYPE "InvoiceStatus" RENAME TO "BillStatus";

-- ── invoices -> bills ────────────────────────────────────────────────────────────
ALTER TABLE "invoices" RENAME TO "bills";
ALTER TABLE "bills" RENAME COLUMN "invoiceNumber" TO "billNumber";
ALTER TABLE "bills" RENAME COLUMN "invoiceDate" TO "billDate";

-- Keep constraint/index names consistent with the new table name so future Prisma
-- diffs don't try to "fix" them.
ALTER INDEX IF EXISTS "invoices_pkey" RENAME TO "bills_pkey";
ALTER INDEX IF EXISTS "invoices_driveFileId_key" RENAME TO "bills_driveFileId_key";
ALTER INDEX IF EXISTS "invoices_zohoId_key" RENAME TO "bills_zohoId_key";
ALTER INDEX IF EXISTS "invoices_vendorId_idx" RENAME TO "bills_vendorId_idx";
ALTER INDEX IF EXISTS "invoices_status_idx" RENAME TO "bills_status_idx";

-- ── zoho_unmatched_invoices -> zoho_unmatched_bills ──────────────────────────────
ALTER TABLE "zoho_unmatched_invoices" RENAME TO "zoho_unmatched_bills";
ALTER TABLE "zoho_unmatched_bills" RENAME COLUMN "invoiceNumber" TO "billNumber";
ALTER TABLE "zoho_unmatched_bills" RENAME COLUMN "invoiceDate" TO "billDate";

ALTER INDEX IF EXISTS "zoho_unmatched_invoices_pkey" RENAME TO "zoho_unmatched_bills_pkey";
ALTER INDEX IF EXISTS "zoho_unmatched_invoices_zohoId_key" RENAME TO "zoho_unmatched_bills_zohoId_key";
