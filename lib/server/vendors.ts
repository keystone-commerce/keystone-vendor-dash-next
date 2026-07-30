import type { Prisma } from "@prisma/client";
import { formatInr } from "@shared";
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
    invoiceCount: v._count?.invoices ?? v.invoices?.length,
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
      include: { _count: { select: { catalogues: true, invoices: true } } },
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
      invoices: { orderBy: { invoiceDate: "desc" } },
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
    invoices: vendor.invoices.map((i) => ({
      ...i,
      invoiceDate: i.invoiceDate.toISOString(),
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

export async function createVendor(dto: any, actorUserId: string | null) {
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
    include: { _count: { select: { catalogues: true, invoices: true } } },
  });
  const header = ["Name", "Category", "Stage", "Status", "Contact Name", "Phone", "Email", "Contract Value", "Rating", "Contract Start", "Contract End", "Catalogues", "Invoices"];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = vendors.map((v) =>
    [v.name, v.category, v.stage, v.status, v.contactName ?? "", v.phone ?? "", v.email ?? "", formatInr(v.contractValue), String(v.rating), v.contractStart ? v.contractStart.toISOString().slice(0, 10) : "", v.contractEnd ? v.contractEnd.toISOString().slice(0, 10) : "", String(v._count.catalogues), String(v._count.invoices)]
      .map(esc)
      .join(","),
  );
  return [header.map(esc).join(","), ...rows].join("\n");
}
