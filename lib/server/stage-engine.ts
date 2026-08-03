import type { Prisma, PrismaClient } from "@prisma/client";
import { VENDOR_STAGE_ORDER, VendorStage } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";

type Tx = Prisma.TransactionClient | PrismaClient;

const GATE_MESSAGES: Partial<Record<VendorStage, string>> = {
  [VendorStage.CATALOGUE_RECEIVED]:
    "Add a catalogue for this vendor before marking them Catalogue Received.",
  [VendorStage.PURCHASE_MADE]: "Add a bill for this vendor before marking them Purchase Made.",
};

const idx = (s: VendorStage) => VENDOR_STAGE_ORDER.indexOf(s);

async function gatePasses(vendorId: string, stage: VendorStage, tx: Tx): Promise<boolean> {
  if (stage === VendorStage.CATALOGUE_RECEIVED) {
    return (await tx.catalogue.count({ where: { vendorId } })) > 0;
  }
  if (stage === VendorStage.PURCHASE_MADE) {
    return (await tx.bill.count({ where: { vendorId } })) > 0;
  }
  return true;
}

/** Manual advance/back. Forward moves are gated; backward moves are always allowed. */
export async function transitionStage(
  vendorId: string,
  input: { direction?: "advance" | "back"; targetStage?: VendorStage },
  actorUserId: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new HttpError(404, "Vendor not found.");

    const currentIndex = idx(vendor.stage as VendorStage);
    let targetStage: VendorStage;
    if (input.targetStage) {
      targetStage = input.targetStage;
    } else if (input.direction === "advance") {
      if (currentIndex >= VENDOR_STAGE_ORDER.length - 1)
        throw new HttpError(400, "Vendor is already at the final stage.");
      targetStage = VENDOR_STAGE_ORDER[currentIndex + 1];
    } else if (input.direction === "back") {
      if (currentIndex <= 0) throw new HttpError(400, "Vendor is already at the first stage.");
      targetStage = VENDOR_STAGE_ORDER[currentIndex - 1];
    } else {
      throw new HttpError(400, "Either direction or targetStage must be provided.");
    }

    const isForward = idx(targetStage) > currentIndex;
    if (isForward && !(await gatePasses(vendorId, targetStage, tx))) {
      throw new HttpError(
        409,
        GATE_MESSAGES[targetStage] ?? "This vendor does not meet the requirements to advance.",
      );
    }

    const updated = await tx.vendor.update({ where: { id: vendorId }, data: { stage: targetStage } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: isForward ? "STAGE_ADVANCE" : "STAGE_BACK",
        entityType: "Vendor",
        entityId: vendorId,
        metadata: { from: vendor.stage, to: targetStage },
      },
    });
    return updated;
  });
}

/** Auto-advance on document attach — only moves forward, never demotes. */
export async function autoAdvanceOnDocumentAttach(
  vendorId: string,
  documentType: "catalogue" | "bill",
  actorUserId: string | null,
  tx: Tx,
) {
  const vendor = await tx.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return;
  const currentIndex = idx(vendor.stage as VendorStage);
  const minimumStage =
    documentType === "bill" ? VendorStage.PURCHASE_MADE : VendorStage.CATALOGUE_RECEIVED;
  if (idx(minimumStage) <= currentIndex) return;

  await tx.vendor.update({ where: { id: vendorId }, data: { stage: minimumStage } });
  await tx.auditLog.create({
    data: {
      userId: actorUserId,
      action: "STAGE_AUTO_ADVANCE",
      entityType: "Vendor",
      entityId: vendorId,
      metadata: { from: vendor.stage, to: minimumStage, trigger: documentType },
    },
  });
}
