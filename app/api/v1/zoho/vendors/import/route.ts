import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireRole } from "@/lib/server/auth";
import { importVendorsFromZoho } from "@/lib/server/zoho/service";

// Reads every vendor contact from Zoho and inserts in one batch; the ceiling is Zoho's
// paging rather than our database work.
export const maxDuration = 60;

/**
 * Create dashboard vendors from the Zoho organisation's vendor contacts, each already
 * linked by zohoVendorId so existing bills match on the next sync.
 *
 * ADMIN only, like the CSV import — one call can create every vendor in the org.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN");
    const body = await req.json().catch(() => ({}));
    return importVendorsFromZoho(String(body?.category ?? ""), user.userId);
  });
}
