import { DocumentSource, BillStatus } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";
import { autoAdvanceOnDocumentAttach } from "./stage-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

function serialize(i: any) {
  return {
    ...i,
    billDate: i.billDate.toISOString(),
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export async function listBills(query: {
  vendorId?: string;
  status?: BillStatus;
  source?: DocumentSource;
  page?: number;
  pageSize?: number;
}) {
  const page = query.page ?? 1;
  const pageSize = Math.min(query.pageSize ?? 50, 200);
  const where = {
    ...(query.vendorId ? { vendorId: query.vendorId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.source ? { source: query.source } : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.bill.findMany({
      where,
      orderBy: { billDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { vendor: { select: { id: true, name: true } } },
    }),
    prisma.bill.count({ where }),
  ]);
  return { items: items.map(serialize), total, page, pageSize };
}

export async function attachBill(vendorId: string, dto: any, actorUserId: string | null) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new HttpError(404, "Vendor not found.");
  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        vendorId,
        billNumber: dto.billNumber,
        amount: dto.amount,
        billDate: dto.billDate ? new Date(dto.billDate) : new Date(),
        status: dto.status ?? BillStatus.UNPAID,
        source: DocumentSource.MANUAL_UPLOAD,
      },
    });
    await autoAdvanceOnDocumentAttach(vendorId, "bill", actorUserId, tx);
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "BILL_ATTACH", entityType: "Bill", entityId: created.id, metadata: { vendorId } },
    });
    return created;
  });
  return serialize(bill);
}

export async function updateBill(id: string, dto: any, actorUserId: string | null) {
  const existing = await prisma.bill.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Bill not found.");
  const bill = await prisma.bill.update({
    where: { id },
    data: {
      billNumber: dto.billNumber,
      amount: dto.amount,
      billDate: dto.billDate ? new Date(dto.billDate) : undefined,
      status: dto.status,
    },
  });
  await audit({ userId: actorUserId, action: "BILL_UPDATE", entityType: "Bill", entityId: id, metadata: { fields: Object.keys(dto) } });
  return serialize(bill);
}

export async function removeBill(id: string, actorUserId: string | null) {
  const existing = await prisma.bill.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Bill not found.");
  await prisma.bill.delete({ where: { id } });
  await audit({ userId: actorUserId, action: "BILL_DELETE", entityType: "Bill", entityId: id, metadata: { vendorId: existing.vendorId } });
  return { success: true };
}

export interface ZohoBillUpsert {
  zohoId: string;
  billNumber: string;
  amount: number;
  billDate: Date;
  dueDate: Date | null;
  status: BillStatus;
  viewUrl: string | null;
}

/** Idempotent upsert of a Zoho-sourced bill, keyed on zohoId. Returns whether it was created. */
export async function upsertFromZoho(
  vendorId: string,
  data: ZohoBillUpsert,
  actorUserId: string | null,
): Promise<{ created: boolean }> {
  const existing = await prisma.bill.findUnique({ where: { zohoId: data.zohoId } });
  if (existing) {
    await prisma.bill.update({
      where: { id: existing.id },
      data: {
        billNumber: data.billNumber,
        amount: data.amount,
        billDate: data.billDate,
        dueDate: data.dueDate,
        status: data.status,
        viewUrl: data.viewUrl ?? undefined,
      },
    });
    return { created: false };
  }
  await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        vendorId,
        billNumber: data.billNumber,
        amount: data.amount,
        billDate: data.billDate,
        dueDate: data.dueDate,
        status: data.status,
        zohoId: data.zohoId,
        viewUrl: data.viewUrl,
        source: DocumentSource.ZOHO_SYNC,
      },
    });
    await autoAdvanceOnDocumentAttach(vendorId, "bill", actorUserId, tx);
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "BILL_ZOHO_CREATE", entityType: "Bill", entityId: created.id, metadata: { vendorId, zohoId: data.zohoId } },
    });
  });
  return { created: true };
}
