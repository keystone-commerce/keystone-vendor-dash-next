import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireRole, HttpError } from "@/lib/server/auth";
import { importVendorsCsv } from "@/lib/server/vendors";

// A 1000-row file is parsed and inserted in one batch; the limit is here so a very large
// paste can't sit past the function timeout.
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Bulk-create vendors from a CSV.
 *
 * ADMIN only. Bulk vendor creation isn't part of a procurement member's job, and a bad
 * file can add hundreds of records in one call — that's an admin action.
 */
export async function POST(req: NextRequest) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Please choose a CSV file to upload.");
    if (file.size === 0) throw new HttpError(400, "That file is empty.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "File is too large (max 2 MB).");

    const text = await file.text();
    return importVendorsCsv(text, user.userId);
  });
}
