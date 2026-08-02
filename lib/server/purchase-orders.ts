import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";
import { sendMail } from "./mail";
import { createZohoPurchaseOrder } from "./zoho";
import { buildPoPdf, type PoPdfStatus } from "./po-pdf";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface PoLine {
  name: string;
  quantity: number;
  rate: number;
  hsn?: string;
  gstPercent?: number;
  itemCode?: string;
  brand?: string;
  uom?: string;
}

function serialize(po: any) {
  return {
    ...po,
    lineItems: po.lineItems ?? [],
    vendorName: po.vendor?.name,
    decidedAt: po.decidedAt ? po.decidedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
    updatedAt: po.updatedAt.toISOString(),
    vendor: undefined,
  };
}

/**
 * Our Keystone-format PDF built straight from a PO record. This is the document used
 * everywhere (View + emails, before and after approval) — same layout throughout, with
 * only the status line and the assigned PO number changing once approved.
 */
function buildKeystonePoPdf(
  po: {
    vendor: any;
    poNumber: string | null;
    createdAt: Date;
    lineItems: unknown;
    status?: string;
  },
  overrides?: { poNumber?: string | null; status?: PoPdfStatus },
): Promise<Buffer> {
  const status =
    overrides?.status ??
    (po.status === "APPROVED" || po.status === "REJECTED" ? po.status : "PENDING");
  return buildPoPdf({
    vendorName: po.vendor.name,
    poNumber: overrides?.poNumber ?? po.poNumber,
    createdAt: po.createdAt,
    vendorCode: po.vendor.zohoVendorId || po.vendor.id,
    status,
    lineItems: (po.lineItems as any[]) ?? [],
    supplier: {
      address: po.vendor.gstAddress,
      gstin: po.vendor.gstin,
      contactName: po.vendor.contactName,
      email: po.vendor.email,
      phone: po.vendor.phone,
    },
  });
}

/**
 * PDF for a purchase order — always our Keystone-format document, so the branded
 * template is what everyone sees (Zoho's own plain PDF is never surfaced). The status
 * line reflects the PO's current state.
 */
export async function getPurchaseOrderPdf(id: string): Promise<Buffer> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw new HttpError(404, "Purchase order not found.");
  return buildKeystonePoPdf(po);
}

/**
 * Base URL used in emails. Prefers an explicit APP_URL, but ignores a localhost
 * value when actually running on Vercel (a common copy-paste from local .env) and
 * falls back to the real deployment URL Vercel injects.
 */
const appUrl = () => {
  const configured = process.env.APP_URL?.trim();
  const onVercel = Boolean(process.env.VERCEL);
  if (configured && !(onVercel && configured.includes("localhost"))) return configured;
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (prod) return `https://${prod}`;
  return "http://localhost:3000";
};

/** Email the member who submitted a PO once it's decided (soft — never throws). */
async function notifyCreator(
  createdById: string | null,
  subject: string,
  text: string,
  attachments?: { filename: string; content: Buffer; contentType?: string }[],
) {
  if (!createdById) return;
  const creator = await prisma.user.findUnique({ where: { id: createdById } });
  if (creator?.email) await sendMail({ to: creator.email, subject, text, attachments });
}

export async function listPurchaseOrders(status?: string) {
  const items = await prisma.purchaseOrder.findMany({
    where: status ? { status: status as any } : {},
    orderBy: { createdAt: "desc" },
    include: { vendor: { select: { name: true } } },
  });
  return items.map(serialize);
}

/** Procurement submits — PENDING, nothing sent to Zoho yet. Emails the approver. */
/**
 * HSN is a numeric tariff code (4/6/8 digits). The form strips non-digits, but the API
 * is callable directly and this value lands on the PO document and in Zoho.
 */
function assertValidHsn(lineItems: PoLine[]) {
  for (const li of lineItems ?? []) {
    const hsn = (li.hsn ?? "").trim();
    if (hsn && !/^\d{4,8}$/.test(hsn)) {
      throw new HttpError(400, `HSN must be 4–8 digits (got "${hsn}" on "${li.name}").`);
    }
  }
}

/**
 * Item Code is a column on the PO document — it's how the supplier identifies the
 * product on their own system. A blank cell makes the line ambiguous, so it's required.
 */
function assertItemCodes(lineItems: PoLine[]) {
  for (const li of lineItems ?? []) {
    if (!(li.itemCode ?? "").trim()) {
      throw new HttpError(400, `Item Code is required (missing on "${li.name}").`);
    }
  }
}

/**
 * The Supplier Details block on the PO prints the contact person and their email /
 * mobile. Those became mandatory on the vendor form, but vendors created before that —
 * and any created straight through the API — can still be missing them, so check here
 * too. Otherwise the document reaches the supplier with blank rows.
 */
function assertVendorContactable(vendor: {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
}) {
  const missing = [
    !vendor.contactName?.trim() && "contact person",
    !vendor.email?.trim() && "email",
    !vendor.phone?.trim() && "mobile",
  ].filter(Boolean);

  if (missing.length) {
    throw new HttpError(
      400,
      `${vendor.name} is missing ${missing.join(", ")}. Add ${missing.length > 1 ? "these" : "this"} on the vendor (Vendors → Edit) — they're printed in the Supplier Details block of the PO.`,
    );
  }
}

/**
 * Email the approvers a PDF of the PO awaiting their decision.
 *
 * Recipients are exactly the ADMIN users, read from the database. Admins are managed on
 * the Team screen, so adding or removing one changes who gets notified with no config
 * edit and no redeploy.
 *
 * Deliberately NOT configurable: this used to read a PO_APPROVER_EMAIL env var, which
 * bypassed the role check and sent approval requests (with the PO PDF attached) to
 * whoever happened to be in that variable — including procurement members, who aren't
 * allowed to approve. Only role decides now.
 *
 * Shared by submit and edit: an edit re-sends so nobody approves against a stale PDF.
 */
async function notifyApprovers(
  po: { id: string; poNumber: string | null; createdAt: Date },
  vendor: any,
  lineItems: PoLine[],
  total: number,
  reason: "submitted" | "updated" | "resubmitted after rejection" = "submitted",
) {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const recipients = [...new Set(admins.map((a) => a.email))].filter(Boolean);

  if (!recipients.length) {
    // Nobody to tell — surface it rather than failing silently like the old code did.
    console.warn(`[po] ${po.id} ${reason} but there is no ADMIN user to notify.`);
    return;
  }

  // Soft-fail: if the PDF can't be built, still send the email without the attachment.
  let attachments;
  try {
    // Same builder the approved PDF uses, so the approver reviews the exact document
    // that later goes out — only the status line differs.
    const pdf = await buildKeystonePoPdf(
      { vendor, poNumber: po.poNumber, createdAt: po.createdAt, lineItems },
      { status: "PENDING" },
    );
    const fileLabel = (po.poNumber || `PO-${po.id.slice(0, 8)}`).replace(/[^\w.-]/g, "_");
    attachments = [{ filename: `${fileLabel}.pdf`, content: pdf, contentType: "application/pdf" }];
  } catch (err) {
    console.warn(`[po] PDF generation failed for ${po.id}: ${(err as Error).message}`);
  }

  const headline =
    reason === "submitted"
      ? "A new Purchase Order request awaits your approval in the Vendor Dashboard."
      : `A Purchase Order awaiting your approval was ${reason}. The details below replace the earlier version.`;

  await sendMail({
    to: recipients.join(", "),
    subject: `PO approval needed — ${vendor.name} (₹${total.toLocaleString("en-IN")})`,
    text:
      `${headline}\n\n` +
      `Vendor: ${vendor.name}\nItems: ${lineItems.length}\nTotal: ₹${total.toLocaleString("en-IN")}\n\n` +
      `The full purchase order is attached as a PDF for your review.\n\n` +
      `Log in to Approve or Reject it:\n${appUrl()}\n`,
    attachments,
  });
}

export async function createPurchaseOrder(
  dto: { vendorId: string; poNumber?: string; lineItems: PoLine[] },
  actorUserId: string | null,
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: dto.vendorId } });
  if (!vendor) throw new HttpError(400, "Vendor not found.");
  assertVendorContactable(vendor);
  assertValidHsn(dto.lineItems);
  assertItemCodes(dto.lineItems);

  const total = dto.lineItems.reduce((s, li) => s + (li.rate || 0) * (li.quantity || 0), 0);
  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId: dto.vendorId,
      zohoVendorId: vendor.zohoVendorId,
      status: "PENDING",
      lineItems: dto.lineItems as any,
      total,
      poNumber: dto.poNumber ?? null,
      createdById: actorUserId,
    },
    include: { vendor: { select: { name: true } } },
  });
  await audit({ userId: actorUserId, action: "PO_SUBMIT", entityType: "PurchaseOrder", entityId: po.id, metadata: { vendorId: dto.vendorId, total } });

  await notifyApprovers(po, vendor, dto.lineItems, total, "submitted");
  return serialize(po);
}

/** Admin approves → create in Zoho + email the vendor, mark APPROVED. */
/**
 * Edit a purchase order that hasn't been actioned yet.
 *
 * Only PENDING and REJECTED POs can be changed. An APPROVED PO already exists in Zoho
 * Books — editing it here would leave the dashboard and Zoho silently disagreeing about
 * what was ordered, so it's refused. Editing a REJECTED one moves it back to PENDING,
 * which is how "fix it and resubmit" works.
 *
 * Admins can edit any editable PO; a procurement member can only edit their own.
 */
export async function updatePurchaseOrder(
  id: string,
  dto: { poNumber?: string | null; lineItems?: PoLine[] },
  actor: { userId: string | null; role: string },
) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw new HttpError(404, "Purchase order not found.");

  if (po.status === "APPROVED") {
    throw new HttpError(
      409,
      "This PO is already approved and exists in Zoho Books, so it can't be edited. Raise a new one instead.",
    );
  }
  if (actor.role !== "ADMIN" && po.createdById && po.createdById !== actor.userId) {
    throw new HttpError(403, "You can only edit purchase orders you raised.");
  }

  const lineItems = dto.lineItems ?? ((po.lineItems as any[]) ?? []);
  if (!lineItems.length) throw new HttpError(400, "A purchase order needs at least one line item.");
  assertVendorContactable(po.vendor);
  assertValidHsn(lineItems);
  assertItemCodes(lineItems);

  const total = lineItems.reduce((s, li) => s + (li.rate || 0) * (li.quantity || 0), 0);
  const wasRejected = po.status === "REJECTED";

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      lineItems: lineItems as any,
      total,
      ...(dto.poNumber !== undefined ? { poNumber: dto.poNumber || null } : {}),
      // Editing a rejected PO puts it back in the queue and clears the old reason.
      ...(wasRejected ? { status: "PENDING", decisionReason: null, decidedAt: null, decidedById: null } : {}),
    },
    include: { vendor: { select: { name: true } } },
  });
  await audit({
    userId: actor.userId,
    action: "PO_UPDATE",
    entityType: "PurchaseOrder",
    entityId: id,
    metadata: { total, items: lineItems.length, resubmitted: wasRejected },
  });

  // The approvers were emailed a PDF of the previous version — re-send so they don't
  // approve against a stale document.
  await notifyApprovers(
    updated,
    po.vendor,
    lineItems,
    total,
    wasRejected ? "resubmitted after rejection" : "updated",
  );

  return serialize(updated);
}

export async function approvePurchaseOrder(id: string, actorUserId: string | null) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw new HttpError(404, "Purchase order not found.");
  if (po.status !== "PENDING") throw new HttpError(409, `This PO is already ${po.status.toLowerCase()}.`);
  if (!po.vendor.zohoVendorId) {
    throw new HttpError(400, "This vendor isn't linked to Zoho yet. Link it before approving.");
  }

  const lineItems = (po.lineItems as any[]) ?? [];
  let result;
  try {
    // No emailTo — we don't want Zoho sending its own plain PDF to the vendor. We
    // email our Keystone PDF ourselves below (to both the vendor and the submitter).
    result = await createZohoPurchaseOrder({
      zohoVendorId: po.vendor.zohoVendorId,
      poNumber: po.poNumber,
      lineItems,
    });
  } catch (err) {
    throw new HttpError(502, `Zoho rejected the Purchase Order: ${(err as Error).message}`);
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "APPROVED",
      zohoId: result.zohoId,
      poNumber: result.poNumber || po.poNumber,
      decidedById: actorUserId,
      decidedAt: new Date(),
      decisionReason: null,
    },
    include: { vendor: { select: { name: true } } },
  });
  await audit({ userId: actorUserId, action: "PO_APPROVE", entityType: "PurchaseOrder", entityId: id, metadata: { zohoId: result.zohoId, poNumber: result.poNumber } });

  // Attach the OFFICIAL Zoho PO PDF to the approval email (the vendor gets the same
  // one from Zoho's own email). Only if Zoho can't produce it do we fall back to our
  // generated PDF — so the submitter gets the real approved document, not the
  // pre-approval one. Soft-fail: still send the message if no PDF can load.
  // Our Keystone-format PDF, now stamped APPROVED and carrying the Zoho-assigned PO
  // number — the same document the approver reviewed, so nobody sees a different
  // template after approval. Soft-fail: still send the emails if the PDF can't build.
  const label = (result.poNumber || po.poNumber || `PO-${id.slice(0, 8)}`).replace(/[^\w.-]/g, "_");
  let attachments;
  try {
    const pdf = await buildKeystonePoPdf(po, {
      poNumber: result.poNumber || po.poNumber,
      status: "APPROVED",
    });
    attachments = [{ filename: `${label}.pdf`, content: pdf, contentType: "application/pdf" }];
  } catch (err) {
    console.warn(`[po] approved PDF unavailable for ${id}: ${(err as Error).message}`);
  }
  // Email the submitter (the member who raised the PO).
  await notifyCreator(
    po.createdById,
    `✅ PO approved — ${po.vendor.name} (${result.poNumber})`,
    `Good news — your Purchase Order has been APPROVED.\n\n` +
      `Vendor: ${po.vendor.name}\n` +
      `PO number: ${result.poNumber}\n` +
      `Total: ₹${po.total.toLocaleString("en-IN")}\n` +
      `${result.zohoId ? "It has been created in Zoho Books.\n" : ""}` +
      `\nThe approved purchase order is attached as a PDF.\n\n${appUrl()}\n`,
    attachments,
  );

  // Email the vendor the same approved PO PDF, from our own (reliable) mail transport
  // rather than Zoho's — Zoho's email step was silently failing under token throttling.
  if (po.vendor.email) {
    try {
      await sendMail({
        to: po.vendor.email,
        subject: `Purchase Order ${result.poNumber || po.poNumber}`,
        text:
          `Dear ${po.vendor.name},\n\n` +
          `Please find attached Purchase Order ${result.poNumber || po.poNumber} from ` +
          `Keystone Commerce Private Limited.\n\n` +
          `Kindly acknowledge acceptance within two (2) working days.\n\n` +
          `Regards,\nKeystone Commerce Private Limited\n`,
        attachments,
      });
    } catch (err) {
      console.warn(`[po] vendor email failed for ${id}: ${(err as Error).message}`);
    }
  }
  return serialize(updated);
}

/** Admin rejects → REJECTED with a reason; nothing goes to Zoho. */
export async function rejectPurchaseOrder(id: string, reason: string | undefined, actorUserId: string | null) {
  const po = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!po) throw new HttpError(404, "Purchase order not found.");
  if (po.status !== "PENDING") throw new HttpError(409, `This PO is already ${po.status.toLowerCase()}.`);

  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: "REJECTED",
      decisionReason: reason || "No reason given",
      decidedById: actorUserId,
      decidedAt: new Date(),
    },
    include: { vendor: { select: { name: true } } },
  });
  await audit({ userId: actorUserId, action: "PO_REJECT", entityType: "PurchaseOrder", entityId: id, metadata: { reason } });
  await notifyCreator(
    po.createdById,
    `PO rejected — ${updated.vendor.name}`,
    `Your Purchase Order for ${updated.vendor.name} (₹${po.total.toLocaleString("en-IN")}) was rejected.\n\n` +
      `Reason: ${updated.decisionReason}\n\nReview or resubmit it:\n${appUrl()}\n`,
  );
  return serialize(updated);
}
