import { NextRequest } from "next/server";
import { DocumentSource, BillStatus } from "@shared";
import { handle } from "@/lib/server/http";
import { requireUser } from "@/lib/server/auth";
import { listBills } from "@/lib/server/bills";

export async function GET(req: NextRequest) {
  return handle(async () => {
    requireUser(req);
    const sp = req.nextUrl.searchParams;
    return listBills({
      vendorId: sp.get("vendorId") ?? undefined,
      status: (sp.get("status") as BillStatus) ?? undefined,
      source: (sp.get("source") as DocumentSource) ?? undefined,
      page: sp.get("page") ? Number(sp.get("page")) : undefined,
      pageSize: sp.get("pageSize") ? Number(sp.get("pageSize")) : undefined,
    });
  });
}
