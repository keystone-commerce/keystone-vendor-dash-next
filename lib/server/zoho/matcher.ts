import { prisma } from "@/lib/prisma";
import type { ZohoBill } from "./client";

export type VendorMatchRecord = {
  id: string;
  name: string;
  zohoVendorId: string | null;
};

/** Match against an already-loaded vendor list so a full sync does not query RDS per bill. */
export function matchVendorFromList(
  bill: ZohoBill,
  vendors: readonly VendorMatchRecord[],
): string | null {
  if (bill.vendorId) {
    const linked = vendors.find((vendor) => vendor.zohoVendorId === bill.vendorId);
    if (linked) return linked.id;
  }
  const name = bill.vendorName?.trim();
  if (!name) return null;

  const nameLower = name.toLowerCase();
  const exact = vendors.find((vendor) => vendor.name.trim().toLowerCase() === nameLower);
  if (exact) return exact.id;

  const partial = vendors.find((vendor) => {
    const vendorName = vendor.name.trim().toLowerCase();
    return vendorName.includes(nameLower) || nameLower.includes(vendorName);
  });
  return partial?.id ?? null;
}

/**
 * Match a Zoho bill to a dashboard vendor:
 *   1. Vendor.zohoVendorId === bill.vendorId (durable link)
 *   2. Exact name (case-insensitive)
 *   3. Partial name match either direction
 * Returns the vendor id, or null (→ unmatched).
 */
export async function matchVendor(bill: ZohoBill): Promise<string | null> {
  const all = await prisma.vendor.findMany({
    select: { id: true, name: true, zohoVendorId: true },
  });
  return matchVendorFromList(bill, all);
}
