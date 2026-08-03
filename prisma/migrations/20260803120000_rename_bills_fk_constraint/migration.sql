-- Finish the invoices -> bills rename: the foreign key constraint.
--
-- 20260731140000_rename_invoice_to_bill renamed the table and its indexes, but Postgres
-- does not rename CONSTRAINTS when a table is renamed, and ALTER INDEX doesn't reach a
-- foreign key (it has no backing index of its own). So "bills" was left carrying
-- "invoices_vendorId_fkey" while Prisma expects "bills_vendorId_fkey" — harmless at
-- runtime, but every future `prisma migrate dev` would try to "fix" it and generate
-- spurious drift.
--
-- Done as a separate migration rather than by editing 20260731140000: Prisma stores a
-- checksum of each applied migration, so editing that file breaks `migrate deploy` on
-- any database that already ran it.
--
-- Guarded so it's a no-op where the constraint is already correctly named (a database
-- built after this point, or one fixed by hand).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_vendorId_fkey'
      AND conrelid = '"bills"'::regclass
  ) THEN
    ALTER TABLE "bills" RENAME CONSTRAINT "invoices_vendorId_fkey" TO "bills_vendorId_fkey";
  END IF;
END $$;
