-- Vendor categories: Postgres enum -> plain text.
--
-- The initial migration created `vendors.category` as an enum ("VendorCategory")
-- holding 7 fixed values. Categories were later moved to a code-managed list in
-- lib/shared/enums.ts (28 values such as "Electronics", "Tools", …) so adding one is
-- a code change rather than a migration.
--
-- That conversion was applied to the original database by hand and never captured
-- here, so any NEW database built from these migrations still got the old enum and
-- rejected every category the app sends:
--   22P02 invalid input value for enum "VendorCategory": "Electronics"
-- Vendor creation failed outright. This migration closes that gap.
--
-- Written to be safe on both shapes: on a database where the column is already text
-- the ALTER is a no-op cast, and DROP TYPE IF EXISTS won't error when the enum is
-- already gone.

ALTER TABLE "vendors" ALTER COLUMN "category" TYPE TEXT USING "category"::text;

DROP TYPE IF EXISTS "VendorCategory";
