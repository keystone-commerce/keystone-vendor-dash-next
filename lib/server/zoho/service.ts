import { BillStatus, GST_STATE_CODES, rupeesToPaise } from "@shared";
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
  return { vendorId, zohoVendorId: created.id, alreadyLinked: false };
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
