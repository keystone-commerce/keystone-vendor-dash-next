import { BillStatus, GST_STATE_CODES, VENDOR_CATEGORIES, gstinError, rupeesToPaise } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "../auth";
import { audit } from "../audit";
import { upsertFromZoho } from "../bills";
import * as client from "./client";
import { matchVendor } from "./matcher";
import { mapZohoStatus } from "./status-util";
import { healthCheck } from "./client";
import { syncModule, zohoDc } from "./auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface SyncResult {
  added: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: number;
}

// Best-effort, per-instance (fine for status display; unmatched itself is in the DB).
let lastSyncAt: string | null = null;
let lastResult: SyncResult | null = null;

function normalizeVendorName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeVendorGstin(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, "").trim().toUpperCase();
}

async function linkVendorToZoho(
  vendorId: string,
  zohoVendorId: string,
  actorUserId: string | null,
  source: "match" | "import",
): Promise<boolean> {
  // Check the current owner before writing, then still handle P2002 because another
  // request can claim the same Zoho ID between this read and the update.
  const owner = await prisma.vendor.findUnique({
    where: { zohoVendorId },
    select: { id: true },
  });
  if (owner && owner.id !== vendorId) return false;

  try {
    await prisma.vendor.update({ where: { id: vendorId }, data: { zohoVendorId } });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return false;
    throw err;
  }
  await audit({
    userId: actorUserId,
    action: "VENDOR_ZOHO_LINK",
    entityType: "Vendor",
    entityId: vendorId,
    metadata: { zohoVendorId, source },
  });
  return true;
}

function toUpsert(bill: client.ZohoBill, status: BillStatus) {
  return {
    zohoId: bill.zohoId,
    billNumber: bill.billNumber,
    amount: rupeesToPaise(bill.total),
    billDate: new Date(bill.date),
    dueDate: bill.dueDate ? new Date(bill.dueDate) : null,
    status,
    viewUrl: bill.viewUrl,
  };
}

export async function runSync(actorUserId: string | null): Promise<SyncResult> {
  const bills = await client.listBills();
  const result: SyncResult = { added: 0, updated: 0, unmatched: 0, skipped: 0, errors: 0 };

  // Rebuild the unmatched view from scratch each sync.
  await prisma.zohoUnmatchedBill.deleteMany({});

  for (const bill of bills) {
    try {
      const status = mapZohoStatus(bill.status);
      if (status === null) {
        result.skipped++;
        continue;
      }
      const existing = await prisma.bill.findUnique({ where: { zohoId: bill.zohoId } });
      if (existing) {
        await upsertFromZoho(existing.vendorId, toUpsert(bill, status), actorUserId);
        result.updated++;
        continue;
      }
      const vendorId = await matchVendor(bill);
      if (!vendorId) {
        await prisma.zohoUnmatchedBill.create({
          data: {
            zohoId: bill.zohoId,
            billNumber: bill.billNumber,
            vendorName: bill.vendorName,
            zohoVendorId: bill.vendorId || null,
            amount: rupeesToPaise(bill.total),
            status,
            billDate: new Date(bill.date),
            dueDate: bill.dueDate ? new Date(bill.dueDate) : null,
            viewUrl: bill.viewUrl,
          },
        });
        result.unmatched++;
        continue;
      }
      const { created } = await upsertFromZoho(vendorId, toUpsert(bill, status), actorUserId);
      created ? result.added++ : result.updated++;
    } catch (err) {
      result.errors++;
      console.warn(`[zoho] failed on "${bill.billNumber}": ${(err as Error).message}`);
    }
  }

  lastSyncAt = new Date().toISOString();
  lastResult = result;
  await audit({ userId: actorUserId, action: "ZOHO_SYNC", entityType: "ZohoSync", entityId: lastSyncAt, metadata: { ...result } });
  return result;
}

export async function listUnmatched() {
  const rows = await prisma.zohoUnmatchedBill.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    zohoId: r.zohoId,
    billNumber: r.billNumber,
    vendorName: r.vendorName,
    zohoVendorId: r.zohoVendorId,
    amount: r.amount,
    status: r.status,
    billDate: r.billDate.toISOString(),
    dueDate: r.dueDate ? r.dueDate.toISOString() : null,
    viewUrl: r.viewUrl,
  }));
}

export async function assignUnmatched(zohoId: string, vendorId: string, actorUserId: string | null) {
  const row = await prisma.zohoUnmatchedBill.findUnique({ where: { zohoId } });
  if (!row) throw new HttpError(404, "Unmatched bill not found (try syncing again).");
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new HttpError(400, "Vendor not found.");

  // Remember the Zoho-vendor → dashboard-vendor link so future bills auto-match.
  if (row.zohoVendorId && vendor.zohoVendorId !== row.zohoVendorId) {
    const clash = await prisma.vendor.findUnique({ where: { zohoVendorId: row.zohoVendorId } });
    if (!clash) await prisma.vendor.update({ where: { id: vendorId }, data: { zohoVendorId: row.zohoVendorId } });
  }

  await upsertFromZoho(
    vendorId,
    {
      zohoId: row.zohoId,
      billNumber: row.billNumber,
      amount: row.amount,
      billDate: row.billDate,
      dueDate: row.dueDate,
      status: row.status,
      viewUrl: row.viewUrl,
    },
    actorUserId,
  );
  await prisma.zohoUnmatchedBill.delete({ where: { zohoId } });
  await audit({ userId: actorUserId, action: "ZOHO_ASSIGN", entityType: "Bill", entityId: zohoId, metadata: { vendorId } });
  return { success: true };
}

export interface ZohoVendorImportResult {
  imported: number;
  /** Already present but not linked because the match was ambiguous or already linked elsewhere. */
  skippedExisting: number;
  /** Existing dashboard vendors that were linked to their matching Zoho contact. */
  linkedExisting: number;
  /** Zoho contacts that matched multiple dashboard vendors or multiple contacts claimed one vendor. */
  ambiguous: string[];
  /** Dashboard vendors already linked to a different Zoho contact, or lost a race while linking. */
  conflicts: string[];
  /** Zoho contacts skipped because another Zoho contact has the same normalized name. */
  duplicateZohoNames: string[];
  /** Imported, but missing mobile or email, so PO communication is blocked for them. */
  incomplete: string[];
  totalFromZoho: number;
}

/**
 * Create dashboard vendors from the Zoho organisation's vendor contacts.
 *
 * The point is the `zohoVendorId` link: bills already in Zoho then match on the next sync
 * by id rather than by name, so spelling differences ("Wildcraft India Limited" vs
 * "WILDCRAFT INDIA LTD") stop mattering and nothing has to be assigned by hand.
 *
 * Read-only against Zoho — it calls GET /contacts and writes only to our database, so it
 * cannot create a duplicate contact there. And because each vendor arrives already
 * linked, a later "Create in Zoho & link" short-circuits instead of making a second one.
 *
 * Contact person / mobile / email are deliberately allowed to be blank here, unlike
 * createVendor(). These are pre-existing suppliers and Zoho often doesn't hold all three;
 * refusing them would leave their bills unmatched, which is the manual work this exists to
 * remove. Nothing unsafe reaches a supplier because raising a PO separately requires those
 * details (assertVendorContactable), so an incomplete vendor simply can't produce a
 * document until someone fills them in. They're returned in `incomplete` so it's visible.
 */
export async function importVendorsFromZoho(
  category: string,
  actorUserId: string | null,
): Promise<ZohoVendorImportResult> {
  if (!VENDOR_CATEGORIES.includes(category as any)) {
    throw new HttpError(400, "Pick a category to file the imported vendors under.");
  }

  const zohoVendors = await client.listVendors();
  if (!zohoVendors.length) {
    return {
      imported: 0,
      skippedExisting: 0,
      linkedExisting: 0,
      ambiguous: [],
      conflicts: [],
      duplicateZohoNames: [],
      incomplete: [],
      totalFromZoho: 0,
    };
  }

  // Read existing vendors once — same reason the bill sync does.
  const existing = await prisma.vendor.findMany({
    select: { id: true, name: true, gstin: true, zohoVendorId: true },
  });
  const linkedIds = new Set(existing.map((v) => v.zohoVendorId).filter(Boolean) as string[]);
  const gstins = new Set(
    existing.map((v) => normalizeVendorGstin(v.gstin)).filter(Boolean),
  );

  const rows: any[] = [];
  const incomplete: string[] = [];
  let skippedExisting = 0;
  let linkedExisting = 0;
  const ambiguous: string[] = [];
  const conflicts: string[] = [];
  const duplicateZohoNames: string[] = [];
  const seenNames = new Set<string>();
  const linkedDashboardIds = new Set<string>();
  const linksToWrite: { name: string; vendorId: string; zohoVendorId: string }[] = [];

  // Work out which vendors are actually new before spending a request on each. A matching
  // dashboard vendor is linked in place, rather than skipped, so it will use the durable
  // Zoho ID for bills and future "Create in Zoho & link" actions.
  const candidates = zohoVendors.filter((v) => {
    const name = v.name.trim();
    if (!name) return false;
    if (linkedIds.has(v.id)) {
      skippedExisting++;
      return false;
    }

    const gstin = normalizeVendorGstin(v.gstin);
    const gstMatches = gstin
      ? existing.filter((row) => normalizeVendorGstin(row.gstin) === gstin)
      : [];
    const nameMatches = existing.filter(
      (row) => normalizeVendorName(row.name) === normalizeVendorName(name),
    );
    // GSTIN is the stronger identity signal. Only fall back to a name match when no
    // dashboard GSTIN match exists.
    const matches = gstMatches.length ? gstMatches : nameMatches;
    if (matches.length) {
      // Never guess when multiple records match.
      if (matches.length > 1) {
        ambiguous.push(name);
        return false;
      }

      if (matches.length === 1) {
        const match = matches[0];
        if (!match.zohoVendorId && !linkedDashboardIds.has(match.id)) {
          linksToWrite.push({ name, vendorId: match.id, zohoVendorId: v.id });
          linkedDashboardIds.add(match.id);
          return false;
        }
        if (linkedDashboardIds.has(match.id)) {
          ambiguous.push(name);
        } else {
          conflicts.push(name);
        }
      }
      return false;
    }

    if (seenNames.has(normalizeVendorName(name))) {
      // Two Zoho contacts can share a name; keep the first rather than create confusing
      // near-duplicates in the dashboard.
      duplicateZohoNames.push(name);
      return false;
    }
    seenNames.add(normalizeVendorName(name));
    return true;
  });

  for (const link of linksToWrite) {
    if (await linkVendorToZoho(link.vendorId, link.zohoVendorId, actorUserId, "import")) {
      linkedExisting++;
    } else {
      conflicts.push(link.name);
    }
  }

  // The contacts list omits contact_persons, addresses and gst_no, so each new vendor
  // needs its own GET /contacts/{id}. Batched a few at a time: sequential would be slow
  // for a few dozen vendors, and unbounded parallelism would run into Zoho's 100
  // requests/minute. A detail fetch that fails leaves that vendor sparse rather than
  // failing the whole import.
  const DETAIL_CONCURRENCY = 4;
  const details = new Map<string, Partial<client.ZohoVendorSummary>>();
  for (let i = 0; i < candidates.length; i += DETAIL_CONCURRENCY) {
    const slice = candidates.slice(i, i + DETAIL_CONCURRENCY);
    const settled = await Promise.all(
      slice.map((v) =>
        client
          .fetchVendorDetail(v.id)
          .catch((err) => {
            console.warn(`[zoho] detail fetch failed for "${v.name}": ${(err as Error).message}`);
            return {} as Partial<client.ZohoVendorSummary>;
          }),
      ),
    );
    slice.forEach((v, j) => details.set(v.id, settled[j]));
  }

  for (const listed of candidates) {
    const name = listed.name.trim();
    // Detail wins where it has a value; the list is the fallback.
    const d = details.get(listed.id) ?? {};
    const v: client.ZohoVendorSummary = {
      id: listed.id,
      name,
      contactName: d.contactName ?? listed.contactName,
      email: d.email ?? listed.email,
      phone: d.phone ?? listed.phone,
      gstin: d.gstin ?? listed.gstin,
      billingAddress: d.billingAddress,
      shippingAddress: d.shippingAddress,
    };
    // A malformed GSTIN from Zoho is dropped rather than stored — it drives the CGST/SGST
    // vs IGST split on the PO, so a wrong one is worse than none. Also skipped if another
    // vendor already holds it, since the column is unique.
    const gstin =
      v.gstin && !gstinError(v.gstin) && !gstins.has(normalizeVendorGstin(v.gstin))
        ? normalizeVendorGstin(v.gstin)
        : null;
    if (gstin) gstins.add(gstin);

    if (!v.phone || !v.email) incomplete.push(name);

    rows.push({
      name,
      category,
      zohoVendorId: v.id,
      contactName: v.contactName ?? null,
      phone: v.phone ?? null,
      email: v.email ?? null,
      gstin,
      // Zoho's registered address is the best available value for ours.
      gstAddress: v.billingAddress ?? null,
      billingAddress: v.billingAddress ?? null,
      shippingAddress: v.shippingAddress ?? v.billingAddress ?? null,
    });
  }

  let imported = 0;
  if (rows.length) {
    // skipDuplicates covers the unique zohoVendorId/gstin indexes if a concurrent import
    // got there first.
    const written = await prisma.vendor.createMany({ data: rows, skipDuplicates: true });
    imported = written.count;
    await audit({
      userId: actorUserId,
      action: "ZOHO_VENDOR_IMPORT",
      entityType: "Vendor",
      entityId: "bulk",
      metadata: { imported, skippedExisting, incomplete: incomplete.length, category },
    });
  }

  return {
    imported,
    skippedExisting,
    linkedExisting,
    ambiguous,
    conflicts,
    duplicateZohoNames,
    incomplete,
    totalFromZoho: zohoVendors.length,
  };
}

export interface ZohoVendorDetailRefreshResult {
  totalLinked: number;
  refreshed: number;
  updated: number;
  incomplete: string[];
  errors: string[];
}

/**
 * Refresh details for vendors already linked to Zoho. The initial import skips a
 * vendor whose Zoho ID is already present; this separate pass fills contact details
 * that were missing or unavailable during that import without creating anything in Zoho.
 */
export async function refreshLinkedVendorDetails(
  actorUserId: string | null,
): Promise<ZohoVendorDetailRefreshResult> {
  const linked = await prisma.vendor.findMany({
    where: { zohoVendorId: { not: null } },
    select: {
      id: true,
      name: true,
      zohoVendorId: true,
      contactName: true,
      phone: true,
      email: true,
      gstin: true,
      gstAddress: true,
      billingAddress: true,
      shippingAddress: true,
    },
    orderBy: { name: "asc" },
  });

  const gstinOwners = new Map<string, string>();
  const gstinRows = await prisma.vendor.findMany({ select: { id: true, gstin: true } });
  for (const row of gstinRows) {
    const gstin = normalizeVendorGstin(row.gstin);
    if (gstin) gstinOwners.set(gstin, row.id);
  }

  let refreshed = 0;
  let updated = 0;
  const incomplete: string[] = [];
  const errors: string[] = [];
  const DETAIL_CONCURRENCY = 4;

  for (let i = 0; i < linked.length; i += DETAIL_CONCURRENCY) {
    const slice = linked.slice(i, i + DETAIL_CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (vendor) => {
        try {
          return { vendor, detail: await client.fetchVendorDetail(vendor.zohoVendorId as string) };
        } catch (err) {
          return { vendor, error: (err as Error).message };
        }
      }),
    );

    for (const result of settled) {
      const vendor = result.vendor;
      if ("error" in result) {
        errors.push(`${vendor.name}: ${result.error}`);
        if (!vendor.phone || !vendor.email) incomplete.push(vendor.name);
        continue;
      }

      const detail = result.detail;
      const data: Record<string, string> = {};
      if (detail.contactName) data.contactName = detail.contactName;
      if (detail.phone) data.phone = detail.phone;
      if (detail.email) data.email = detail.email;
      if (detail.billingAddress) {
        data.billingAddress = detail.billingAddress;
        data.gstAddress = detail.billingAddress;
      }
      if (detail.shippingAddress) data.shippingAddress = detail.shippingAddress;

      const gstin = normalizeVendorGstin(detail.gstin);
      if (gstin && !gstinError(gstin)) {
        const owner = gstinOwners.get(gstin);
        if (!owner || owner === vendor.id) {
          data.gstin = gstin;
          gstinOwners.set(gstin, vendor.id);
        } else {
          errors.push(`${vendor.name}: GSTIN ${gstin} is already assigned to another vendor.`);
        }
      }

      if (Object.keys(data).length) {
        await prisma.vendor.update({ where: { id: vendor.id }, data });
        updated++;
      }
      refreshed++;

      const merged = { ...vendor, ...data };
      if (!merged.phone || !merged.email) incomplete.push(vendor.name);
    }
  }

  await audit({
    userId: actorUserId,
    action: "ZOHO_VENDOR_DETAIL_REFRESH",
    entityType: "Vendor",
    entityId: "linked",
    metadata: { totalLinked: linked.length, refreshed, updated, incomplete: incomplete.length, errors: errors.length },
  });

  return { totalLinked: linked.length, refreshed, updated, incomplete, errors };
}

export async function getStatus() {
  const enabled = process.env.ZOHO_ENABLED === "true";
  const health = enabled ? await healthCheck() : { ok: false, message: "Demo mode (ZOHO_ENABLED=false)." };
  const unmatchedCount = await prisma.zohoUnmatchedBill.count();
  return {
    enabled,
    connected: health.ok,
    syncModule: syncModule(),
    dataCenter: zohoDc(),
    lastSyncAt,
    lastResult,
    unmatchedCount,
    message: health.message,
  };
}

/** A Zoho id arrives as JSON — accept a string or number, reject objects/arrays/null. */
function scalarId(v: unknown, field: string): string {
  if (typeof v !== "string" && typeof v !== "number") {
    throw new HttpError(400, `${field} must be a string or number.`);
  }
  const s = String(v).trim();
  if (!s) throw new HttpError(400, `${field} cannot be empty.`);
  return s;
}

/** Optional yyyy-mm-dd date from the request body. */
function optionalDate(v: unknown, field: string): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    throw new HttpError(400, `${field} must be a date in yyyy-mm-dd format.`);
  }
  return v.trim();
}

/**
 * Validate the line items from the request body.
 *
 * client.createBill reads li.name/rate/quantity off each entry, so a payload like
 * `lineItems: [null]` would get past a length check and then throw a TypeError as a 500.
 * Every entry is checked here so bad input is a 400 that says what's wrong.
 */
function parseBillLineItems(v: unknown): { name: string; rate: number; quantity: number }[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new HttpError(400, "At least one line item is required.");
  }
  return v.map((li, i) => {
    const at = `lineItems[${i}]`;
    if (typeof li !== "object" || li === null || Array.isArray(li)) {
      throw new HttpError(400, `${at} must be an object.`);
    }
    const row = li as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) throw new HttpError(400, `${at}.name is required.`);

    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpError(400, `${at}.quantity must be a number greater than 0.`);
    }
    const rate = Number(row.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      throw new HttpError(400, `${at}.rate must be a number of 0 or more.`);
    }
    return { name, rate, quantity };
  });
}

export async function createZohoBill(dto: any, actorUserId: string | null) {
  // The body arrives as unvalidated JSON. Everything is checked before the remote POST:
  // Zoho can't be un-called, so a payload that would fail halfway has to be rejected here.
  // `customerId` is accepted as the previous name for contactId.
  const contactId = scalarId(dto?.contactId ?? dto?.customerId, "contactId");
  const lineItems = parseBillLineItems(dto?.lineItems);
  const date = optionalDate(dto?.date, "date");
  const dueDate = optionalDate(dto?.dueDate, "dueDate");
  const referenceNumber =
    dto?.referenceNumber === undefined || dto?.referenceNumber === null
      ? undefined
      : String(dto.referenceNumber).trim() || undefined;

  const result = await client.createBill({ contactId, date, dueDate, referenceNumber, lineItems });

  // The bill now exists in Zoho, and Zoho has no idempotency key — so a retry would
  // create a second one. Failing to write our own audit row must therefore not surface as
  // an error, or the caller retries a POST that already succeeded. Log it and move on:
  // a missing audit row is recoverable, a duplicate bill in the accounts is not.
  try {
    await audit({
      userId: actorUserId,
      action: "ZOHO_BILL_CREATE",
      entityType: "ZohoBill",
      entityId: result.zohoId,
      metadata: { billNumber: result.billNumber, total: result.total },
    });
  } catch (err) {
    console.warn(
      `[zoho] bill ${result.billNumber} (${result.zohoId}) was created but the audit row failed: ${(err as Error).message}`,
    );
  }

  return result;
}

export async function createAndLinkVendor(vendorId: string, actorUserId: string | null) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new HttpError(400, "Vendor not found.");
  if (vendor.zohoVendorId) return { vendorId, zohoVendorId: vendor.zohoVendorId, alreadyLinked: true };

  // Check Zoho first. The dashboard only stores the Zoho ID after a link, so without this
  // lookup an existing Zoho contact would be treated as new and a duplicate could be made.
  let zohoVendors: client.ZohoVendorSummary[];
  try {
    zohoVendors = await client.listVendors();
  } catch (err) {
    throw new HttpError(502, `Could not check existing Zoho vendors: ${(err as Error).message}`);
  }

  const gstin = normalizeVendorGstin(vendor.gstin);
  const gstMatches = gstin
    ? zohoVendors.filter((candidate) => normalizeVendorGstin(candidate.gstin) === gstin)
    : [];
  const nameMatches = zohoVendors.filter(
    (candidate) => normalizeVendorName(candidate.name) === normalizeVendorName(vendor.name),
  );
  const matches = gstMatches.length ? gstMatches : nameMatches;

  if (matches.length > 1) {
    throw new HttpError(
      409,
      gstMatches.length
        ? `Multiple Zoho vendors have GSTIN ${gstin}. Choose the correct Zoho vendor ID and link it manually.`
        : `Multiple Zoho vendors are named "${vendor.name}". Choose the correct Zoho vendor ID and link it manually.`,
    );
  }

  if (matches.length === 1) {
    if (!(await linkVendorToZoho(vendorId, matches[0].id, actorUserId, "match"))) {
      throw new HttpError(409, "That Zoho vendor is already linked to another dashboard vendor.");
    }
    return {
      vendorId,
      zohoVendorId: matches[0].id,
      alreadyLinked: false,
      matchedExisting: true,
    };
  }

  let created;
  try {
    created = await client.createVendor({
      name: vendor.name,
      email: vendor.email ?? undefined,
      phone: vendor.phone ?? undefined,
      // Sending the GSTIN is what makes Zoho mark the vendor GST-registered.
      gstin: vendor.gstin ?? undefined,
      gstStateName: vendor.gstin ? GST_STATE_CODES[vendor.gstin.slice(0, 2)] : undefined,
      // Fall back to the GST address when no billing address was captured — it's the
      // registered address, so it's the right default for the Zoho contact.
      billingAddress: vendor.billingAddress ?? vendor.gstAddress ?? undefined,
      shippingAddress: vendor.shippingAddress ?? undefined,
    });
  } catch (err) {
    throw new HttpError(502, `Zoho vendor create failed: ${(err as Error).message}`);
  }
  await prisma.vendor.update({ where: { id: vendorId }, data: { zohoVendorId: created.id } });
  await audit({ userId: actorUserId, action: "ZOHO_VENDOR_CREATE_LINK", entityType: "Vendor", entityId: vendorId, metadata: { zohoVendorId: created.id } });
  return { vendorId, zohoVendorId: created.id, alreadyLinked: false, matchedExisting: false };
}

export async function listZohoVendors() {
  try {
    return await client.listVendors();
  } catch (err) {
    throw new HttpError(502, `Could not list Zoho vendors: ${(err as Error).message}`);
  }
}

export async function getBillPdf(zohoId: string): Promise<Buffer> {
  return client.fetchBillPdf(zohoId);
}
