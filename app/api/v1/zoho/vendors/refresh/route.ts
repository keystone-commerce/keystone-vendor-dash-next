import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireRole } from "@/lib/server/auth";
import { refreshLinkedVendorDetails } from "@/lib/server/zoho/service";

// Refreshes existing links only; it does not create or modify Zoho contacts.
export const maxDuration = 60;

/** ADMIN-only refresh for contact person, phone, email, GSTIN and addresses. */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN");
    return refreshLinkedVendorDetails(user.userId);
  });
}
