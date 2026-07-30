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
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_gstin_key" ON "vendors"("gstin");
