import type { Prisma } from "@prisma/client";
import { formatInr, gstinError } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";

/* eslint-disable @typescript-eslint/no-explicit-any */

function serialize(v: any) {
  return {
    ...v,
    contractStart: v.contractStart ? v.contractStart.toISOString() : null,
    contractEnd: v.contractEnd ? v.contractEnd.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    catalogueCount: v._count?.catalogues ?? v.catalogues?.length,
    billCount: v._count?.bills ?? v.bills?.length,
    _count: undefined,
  };
}

export interface VendorQuery {
  search?: string;
  stage?: string;
  status?: string;
  category?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export async function listVendors(q: VendorQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 20;
  const where: Prisma.VendorWhereInput = {
    ...(q.stage ? { stage: q.stage as any } : {}),
    ...(q.status ? { status: q.status as any } : {}),
    ...(q.category ? { category: q.category as any } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" } },
            { contactName: { contains: q.search, mode: "insensitive" } },
            { email: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [items, total] = await prisma.$transaction([
    prisma.vendor.findMany({
      where,
      orderBy: { [q.sortBy ?? "createdAt"]: q.sortDir ?? "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { catalogues: true, bills: true } } },
    }),
    prisma.vendor.count({ where }),
  ]);
  return { items: items.map(serialize), total, page, pageSize };
}

export async function getVendor(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: {
      catalogues: {
        orderBy: { uploadedAt: "desc" },
        include: { items: { orderBy: { createdAt: "asc" } } },
      },
      bills: { orderBy: { billDate: "desc" } },
    },
  });
  if (!vendor) throw new HttpError(404, "Vendor not found.");
  return serialize({
    ...vendor,
    catalogues: vendor.catalogues.map((c) => ({
      ...c,
      uploadedAt: c.uploadedAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
      items: c.items.map((it) => ({ ...it, createdAt: it.createdAt.toISOString() })),
    })),
    bills: vendor.bills.map((i) => ({
      ...i,
      billDate: i.billDate.toISOString(),
      dueDate: i.dueDate ? i.dueDate.toISOString() : null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    })),
  });
}

/**
 * Turn a unique-constraint violation (Prisma P2002) into a readable 409 instead of
 * letting it bubble up as a 500 — `gstin` and `zohoVendorId` are both unique.
 */
const FRIENDLY_UNIQUE_FIELD: Record<string, string> = {
  gstin: "That GSTIN is already assigned to another vendor.",
  zohoVendorId: "That Zoho vendor is already linked to another vendor.",
};

function rethrowUniqueViolation(err: unknown): never {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code === "P2002") {
    const targets = Array.isArray(e.meta?.target)
      ? (e.meta?.target as string[])
      : typeof e.meta?.target === "string"
        ? [e.meta.target as string]
        : [];
    const field = targets.find((t) => FRIENDLY_UNIQUE_FIELD[t]);
    throw new HttpError(409, field ? FRIENDLY_UNIQUE_FIELD[field] : "That value is already in use.");
  }
  throw err;
}

/**
 * GSTIN is optional, but if supplied it must be a real one — it lands on the purchase
 * order sent to the vendor and decides the CGST/SGST vs IGST split, so a malformed
 * value produces a wrong tax document rather than just a cosmetic problem.
 */
function assertValidGstin(gstin: unknown) {
  const value = typeof gstin === "string" ? gstin.trim() : "";
  if (!value) return; // optional
  const problem = gstinError(value);
  if (problem) throw new HttpError(400, problem);
}

/**
 * Contact person, mobile and email are printed in the Supplier Details block of every
 * purchase order, so a vendor missing them produces a PO with blank rows and no way for
 * anyone to reach the supplier about it. All three are required.
 *
 * On update only the keys actually sent are checked, so a PATCH that touches unrelated
 * fields still works — but none of the three can be cleared back to empty.
 */
function assertContactDetails(dto: any, { partial }: { partial: boolean }) {
  const check = (
    key: "contactName" | "phone" | "email",
    label: string,
    validate?: (v: string) => string | null,
  ) => {
    if (partial && dto[key] === undefined) return;
    const value = typeof dto[key] === "string" ? dto[key].trim() : "";
    if (!value) {
      throw new HttpError(
        400,
        `${label} is required — it's printed on every purchase order sent to this vendor.`,
      );
    }
    const problem = validate?.(value);
    if (problem) throw new HttpError(400, problem);
  };

  check("contactName", "Contact person");
  check("phone", "Mobile number", (v) =>
    /^\d{10}$/.test(v) ? null : "Mobile number must be exactly 10 digits.",
  );
  check("email", "Email", (v) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Enter a valid email address.",
  );
}

export async function createVendor(dto: any, actorUserId: string | null) {
  assertValidGstin(dto.gstin);
  assertContactDetails(dto, { partial: false });
  let vendor;
  try {
    vendor = await prisma.vendor.create({
      data: {
        name: dto.name,
        category: dto.category,
        status: dto.status ?? "ACTIVE",
        contactName: dto.contactName,
        phone: dto.phone,
        email: dto.email,
        contractValue: dto.contractValue ?? 0,
        rating: dto.rating ?? 0,
        contractStart: dto.contractStart ? new Date(dto.contractStart) : null,
        contractEnd: dto.contractEnd ? new Date(dto.contractEnd) : null,
        notes: dto.notes,
        gstin: dto.gstin || null,
        gstAddress: dto.gstAddress || null,
      },
    });
  } catch (err) {
    rethrowUniqueViolation(err);
  }
  await audit({ userId: actorUserId, action: "VENDOR_CREATE", entityType: "Vendor", entityId: vendor.id, metadata: { name: vendor.name } });
  return serialize(vendor);
}

export async function updateVendor(id: string, dto: any, actorUserId: string | null) {
  assertValidGstin(dto.gstin);
  assertContactDetails(dto, { partial: true });
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Vendor not found.");
  let vendor;
  try {
    vendor = await prisma.vendor.update({
      where: { id },
      data: {
        ...dto,
        contractStart: dto.contractStart ? new Date(dto.contractStart) : undefined,
        contractEnd: dto.contractEnd ? new Date(dto.contractEnd) : undefined,
      },
    });
  } catch (err) {
    rethrowUniqueViolation(err);
  }
  await audit({ userId: actorUserId, action: "VENDOR_UPDATE", entityType: "Vendor", entityId: id, metadata: { fields: Object.keys(dto) } });
  return serialize(vendor);
}

export async function deleteVendor(id: string, actorUserId: string | null) {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Vendor not found.");
  await prisma.vendor.delete({ where: { id } });
  await audit({ userId: actorUserId, action: "VENDOR_DELETE", entityType: "Vendor", entityId: id, metadata: { name: existing.name } });
  return { success: true };
}

export async function setZohoLink(id: string, zohoVendorId: string | null, actorUserId: string | null) {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Vendor not found.");
  const vendor = await prisma.vendor.update({ where: { id }, data: { zohoVendorId } });
  await audit({ userId: actorUserId, action: "VENDOR_ZOHO_LINK", entityType: "Vendor", entityId: id, metadata: { zohoVendorId } });
  return serialize(vendor);
}

export async function vendorsCsv(): Promise<string> {
  const vendors = await prisma.vendor.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { catalogues: true, bills: true } } },
  });
  const header = ["Name", "Category", "Stage", "Status", "Contact Name", "Phone", "Email", "Contract Value", "Rating", "Contract Start", "Contract End", "Catalogues", "Bills"];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = vendors.map((v) =>
    [v.name, v.category, v.stage, v.status, v.contactName ?? "", v.phone ?? "", v.email ?? "", formatInr(v.contractValue), String(v.rating), v.contractStart ? v.contractStart.toISOString().slice(0, 10) : "", v.contractEnd ? v.contractEnd.toISOString().slice(0, 10) : "", String(v._count.catalogues), String(v._count.bills)]
      .map(esc)
      .join(","),
  );
  return [header.map(esc).join(","), ...rows].join("\n");
}
