import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/server/auth";
import { vendorImportTemplateCsv } from "@/lib/server/vendors";

/** Blank CSV template for the bulk vendor import. ADMIN only, like the import itself. */
export async function GET(req: NextRequest) {
  try {
    requireRole(req, "ADMIN");
  } catch {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  return new NextResponse(vendorImportTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vendor-import-template.csv"`,
    },
  });
}
