import { NextRequest } from "next/server";
import { handle } from "@/lib/server/http";
import { requireRole } from "@/lib/server/auth";
import { updatePurchaseOrder } from "@/lib/server/purchase-orders";

type Ctx = { params: { id: string } };

/**
 * Edit a purchase order that hasn't been actioned yet. Only PENDING and REJECTED POs
 * can change — an APPROVED one already exists in Zoho Books, so the server refuses it
 * with a 409. A procurement member may only edit their own; admins can edit any.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN", "PROCUREMENT_MEMBER");
    return updatePurchaseOrder(params.id, await req.json(), {
      userId: user.userId,
      role: user.role,
    });
  });
}
