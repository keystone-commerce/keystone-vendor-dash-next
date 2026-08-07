-- The billing office selected when the PO is created.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;
