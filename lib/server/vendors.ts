import type { Prisma } from "@prisma/client";
import { VENDOR_CATEGORIES, formatInr, gstinError } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";
import { csvEscape, parseCsv } from "./csv";

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
        billingAddress: dto.billingAddress || null,
        shippingAddress: dto.shippingAddress || null,
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

// ── CSV bulk import (ADMIN only — enforced at the route) ─────────────────────────────

export interface VendorImportResult {
  /** Rows created. 0 when the file was rejected. */
  imported: number;
  /** Rows that matched a vendor we already have — not an error, just nothing to do. */
  skippedExisting: number;
  /** Names of rows skipped because that vendor name or GSTIN already exists. */
  skippedNames: string[];
  /** Data rows found in the file (excluding the header and blank lines). */
  totalRows: number;
  /** Populated only when the file was rejected; `imported` is then 0. */
  errors: { row: number; message: string }[];
}

/** Column aliases, matched loosely so header order and punctuation don't matter. */
const IMPORT_COLUMNS: Record<string, string[]> = {
  name: ["name", "vendorname", "vendor"],
  category: ["category"],
  contactName: ["contactname", "contactperson", "contact"],
  phone: ["phone", "mobile", "mobilenumber", "phonenumber"],
  email: ["email", "emailaddress"],
  contractValue: ["contractvalue", "value"],
  rating: ["rating"],
  contractStart: ["contractstart", "startdate"],
  contractEnd: ["contractend", "enddate"],
  gstin: ["gstin", "gst", "gstno", "gstnumber"],
  billingAddress: ["billingaddress"],
  shippingAddress: ["shippingaddress"],
  gstAddress: ["fulladdress", "fulladdressregistered", "address", "gstaddress"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Rupee text from a spreadsheet ("₹1,23,456.00", "1234") to whole rupees. */
function parseRupees(raw: string): number | null {
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** yyyy-mm-dd, rejecting values that don't round-trip (e.g. 2026-02-30). */
function parseIsoDate(raw: string): Date | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "invalid";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return "invalid";
  }
  return dt;
}

const MAX_IMPORT_ROWS = 1000;

/**
 * Create vendors from a CSV file.
 *
 * All-or-nothing on validation: the whole file is checked first, and a single bad row
 * means nothing is imported. A half-applied bulk import is worse than none — you'd have
 * to work out which rows landed before re-uploading.
 *
 * Vendors that already exist (same name, case-insensitive, or same GSTIN) are *skipped*
 * rather than failed, so re-uploading a file after fixing a few rows is safe and doesn't
 * duplicate anything.
 *
 * The column set round-trips with `vendorsCsv()`, so an export can be edited and fed
 * straight back in; derived columns (Stage, Status, Catalogues, Bills) are ignored.
 */
export async function importVendorsCsv(
  csvText: string,
  actorUserId: string | null,
): Promise<VendorImportResult> {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new HttpError(400, "That file is empty.");

  // ── header ────────────────────────────────────────────────────────────────────────
  const header = rows[0].map(norm);
  const indexOf: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(IMPORT_COLUMNS)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) indexOf[field] = i;
  }

  const required = ["name", "category", "contactName", "phone", "email"] as const;
  const missing = required.filter((f) => indexOf[f] === undefined);
  if (missing.length) {
    const labels: Record<string, string> = {
      name: "Name",
      category: "Category",
      contactName: "Contact Name",
      phone: "Phone",
      email: "Email",
    };
    throw new HttpError(
      400,
      `The file is missing these columns: ${missing.map((m) => labels[m]).join(", ")}. Download the template to see the expected header.`,
    );
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new HttpError(
      413,
      `That file has ${dataRows.length} rows; the limit is ${MAX_IMPORT_ROWS} per upload. Split it and import in batches.`,
    );
  }

  // ── existing vendors, read once ───────────────────────────────────────────────────
  const existing = await prisma.vendor.findMany({ select: { name: true, gstin: true } });
  const existingNames = new Set(existing.map((v) => v.name.trim().toLowerCase()));
  const existingGstins = new Set(existing.filter((v) => v.gstin).map((v) => v.gstin as string));

  const errors: { row: number; message: string }[] = [];
  const seenNames = new Set<string>();
  const seenGstins = new Set<string>();
  const toCreate: Prisma.VendorCreateManyInput[] = [];
  let skippedExisting = 0;
  const skippedNames: string[] = [];

  const categories = new Set(VENDOR_CATEGORIES.map((c) => c.toLowerCase()));

  dataRows.forEach((cells, i) => {
    const rowNo = i + 2; // 1-based, and the header is row 1 — matches what the user sees
    const at = (field: string) =>
      indexOf[field] === undefined ? "" : (cells[indexOf[field]] ?? "").trim();
    const fail = (msg: string) => errors.push({ row: rowNo, message: msg });

    const name = at("name");
    if (!name) return fail("Name is required.");

    // Duplicates are decided before validating the rest — no point reporting a bad
    // phone number on a vendor we're going to skip anyway.
    const lower = name.toLowerCase();
    const gstin = at("gstin").toUpperCase().replace(/\s/g, "");

    if (existingNames.has(lower) || (gstin && existingGstins.has(gstin))) {
      skippedExisting++;
      skippedNames.push(name);
      return;
    }
    if (seenNames.has(lower)) return fail(`"${name}" appears more than once in this file.`);
    if (gstin && seenGstins.has(gstin)) return fail(`GSTIN ${gstin} appears more than once in this file.`);

    const category = at("category");
    if (!category) return fail("Category is required.");
    if (!categories.has(category.toLowerCase())) {
      return fail(`"${category}" isn't a known category. See the template for valid values.`);
    }

    const contactName = at("contactName");
    if (!contactName) return fail("Contact Name is required.");

    const phone = at("phone").replace(/\D/g, "");
    if (!phone) return fail("Phone is required.");
    if (phone.length !== 10) return fail(`Phone must be exactly 10 digits (got "${at("phone")}").`);

    const email = at("email");
    if (!email) return fail("Email is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(`"${email}" isn't a valid email.`);

    if (gstin) {
      const problem = gstinError(gstin);
      if (problem) return fail(problem);
    }

    const rupees = parseRupees(at("contractValue"));
    if (rupees === null) return fail(`Contract Value "${at("contractValue")}" isn't a number.`);

    const ratingRaw = at("rating");
    const rating = ratingRaw ? Number(ratingRaw) : 0;
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      return fail(`Rating must be a whole number from 0 to 5 (got "${ratingRaw}").`);
    }

    const start = parseIsoDate(at("contractStart"));
    if (start === "invalid") return fail(`Contract Start "${at("contractStart")}" must be yyyy-mm-dd.`);
    const end = parseIsoDate(at("contractEnd"));
    if (end === "invalid") return fail(`Contract End "${at("contractEnd")}" must be yyyy-mm-dd.`);

    seenNames.add(lower);
    if (gstin) seenGstins.add(gstin);

    // Category is stored with the canonical casing from VENDOR_CATEGORIES, so a sheet
    // written as "electronics" doesn't create a value the filters won't match.
    const canonicalCategory =
      VENDOR_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase()) ?? category;

    toCreate.push({
      name,
      category: canonicalCategory,
      contactName,
      phone,
      email,
      contractValue: rupees * 100, // stored as paise
      rating,
      contractStart: start,
      contractEnd: end,
      gstin: gstin || null,
      gstAddress: at("gstAddress") || null,
      billingAddress: at("billingAddress") || null,
      shippingAddress: at("shippingAddress") || null,
    });
  });

  // All-or-nothing: report and write nothing.
  if (errors.length) {
    return { imported: 0, skippedExisting: 0, skippedNames: [], totalRows: dataRows.length, errors };
  }

  let imported = 0;
  if (toCreate.length) {
    // One insert rather than a query per row. skipDuplicates covers the unique GSTIN
    // index in case a concurrent import got there first.
    const written = await prisma.vendor.createMany({ data: toCreate, skipDuplicates: true });
    imported = written.count;
    await audit({
      userId: actorUserId,
      action: "VENDOR_IMPORT_CSV",
      entityType: "Vendor",
      entityId: "bulk",
      metadata: { imported, skippedExisting, totalRows: dataRows.length },
    });
  }

  return { imported, skippedExisting, skippedNames, totalRows: dataRows.length, errors: [] };
}

/** Header + one example row, so an import can start from a correct file. */
export function vendorImportTemplateCsv(): string {
  const header = [
    "Name",
    "Category",
    "Contact Name",
    "Phone",
    "Email",
    "Contract Value",
    "Rating",
    "Contract Start",
    "Contract End",
    "GSTIN",
    "Full Address",
    "Billing Address",
    "Shipping Address",
  ];
  const example = [
    "Wildcraft India Limited",
    VENDOR_CATEGORIES[0],
    "Ravi Kumar",
    "9876543210",
    "ravi@wildcraft.in",
    "250000",
    "4",
    "2026-04-01",
    "2027-03-31",
    "29AABCU9603R1ZM",
    "Plot 49, Sira Industrial Area, Tumakuru 572137",
    "Plot 49, Sira Industrial Area, Tumakuru 572137",
    "Plot 49, Sira Industrial Area, Tumakuru 572137",
  ];
  const note = [
    `# Name, Category, Contact Name, Phone (10 digits) and Email are required.`,
    `# Valid categories: ${VENDOR_CATEGORIES.join(" | ")}`,
    `# Delete these comment lines and the example row before uploading.`,
  ];
  return [
    header.map(csvEscape).join(","),
    example.map(csvEscape).join(","),
    ...note.map((n) => csvEscape(n)),
  ].join("\n");
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
