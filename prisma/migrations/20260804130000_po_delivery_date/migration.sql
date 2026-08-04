-- Delivery date on a purchase order.
--
-- The PO document already had a "Delivery Date" cell in its header grid, but nothing
-- filled it because the app never captured the value. Procurement now sets it on the
-- form and it prints on the PDF.
--
-- Nullable: existing POs have no delivery date, and it stays optional so a PO can still
-- be raised before a date has been agreed with the vendor.
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "deliveryDate" TIMESTAMP(3);
