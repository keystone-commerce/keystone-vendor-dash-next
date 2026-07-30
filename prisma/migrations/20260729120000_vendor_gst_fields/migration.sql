-- Vendor GST details. All nullable so existing vendors are unaffected; IF NOT EXISTS
-- keeps this idempotent for environments where the columns were already applied
-- via `prisma db push`.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "gstin" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "legalName" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "tradeName" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "gstAddress" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "gstStateCode" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "gstStatus" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "gstFetchedAt" TIMESTAMP(3);

-- One vendor per GSTIN. Multiple NULLs are allowed by Postgres, so vendors without
-- a GSTIN don't collide.
--
-- Built with a plain CREATE UNIQUE INDEX (not CONCURRENTLY) deliberately: Prisma runs
-- each migration inside a transaction, where CONCURRENTLY is not permitted. The brief
-- write lock is a non-issue here because "vendors" holds tens of rows, not millions —
-- the index build is effectively instantaneous. If this table ever grows large enough
-- for the lock to matter, create the index out-of-band with CONCURRENTLY first and let
-- the IF NOT EXISTS above make this statement a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_gstin_key" ON "vendors"("gstin");
