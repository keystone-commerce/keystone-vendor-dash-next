-- Vendor billing and shipping addresses.
--
-- Billing = where the vendor raises its invoices from; shipping = where goods are
-- dispatched from. Both are pushed to Zoho Books as the contact's billing_address /
-- shipping_address when the vendor is created there, and both appear in the Supplier
-- Details block of the purchase order.
--
-- Free text rather than structured columns, matching the existing gstAddress. The state
-- that actually matters for GST (CGST/SGST vs IGST) is derived from the GSTIN, not from
-- these fields, so splitting them into city/state/zip would add form work without
-- changing any tax behaviour.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "billingAddress" TEXT;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "shippingAddress" TEXT;
