import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";
import { sendMail } from "./mail";
import { createZohoPurchaseOrder } from "./zoho";
import { buildPoPdf } from "./po-pdf";
import { fetchPurchaseOrderPdfWithRetry } from "./zoho/client";

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

/** Our Keystone-format PDF built straight from a PO record (no Zoho round-trip). */
function buildKeystonePoPdf(
  po: { vendor: any; poNumber: string | null; createdAt: Date; lineItems: unknown },
  poNumberOverride?: string | null,
): Promise<Buffer> {
  return buildPoPdf({
    vendorName: po.vendor.name,
    poNumber: poNumberOverride ?? po.poNumber,
    createdAt: po.createdAt,
    vendorCode: po.vendor.zohoVendorId || po.vendor.id,
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
 * PDF for a purchase order. Once approved and created in Zoho, View shows the OFFICIAL
 * Zoho PO PDF (with a short retry, since Zoho can lag right after creation). Pending
 * POs — and any case where Zoho can't produce the PDF — use our Keystone-format PDF.
 */
export async function getPurchaseOrderPdf(id: string): Promise<Buffer> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { vendor: true } });
  if (!po) throw new HttpError(404, "Purchase order not found.");

  if (po.zohoId && process.env.ZOHO_ENABLED === "true") {
    try {
      return await fetchPurchaseOrderPdfWithRetry(po.zohoId);
    } catch (err) {
      // Zoho unavailable — fall back to our generated PDF so View still works.
      console.warn(`[po] Zoho PDF unavailable for ${id}, using generated: ${(err as Error).message}`);
    }
  }

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
export async function createPurchaseOrder(
  dto: { vendorId: string; poNumber?: string; lineItems: PoLine[] },
  actorUserId: string | null,
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: dto.vendorId } });
  if (!vendor) throw new HttpError(400, "Vendor not found.");

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

  const approver = (process.env.PO_APPROVER_EMAIL ?? "").trim();
  if (approver) {
    // Generate the PO as a PDF from our own data so the approver can review the
    // full order before it's approved / created in Zoho. Soft-fail: if the PDF
    // can't be built, still send the email without the attachment.
    let attachments;
    try {
      const pdf = await buildPoPdf({
        vendorName: vendor.name,
        poNumber: po.poNumber,
        createdAt: po.createdAt,
        vendorCode: vendor.zohoVendorId || vendor.id,
        lineItems: dto.lineItems,
        supplier: {
          address: vendor.gstAddress,
          gstin: vendor.gstin,
          contactName: vendor.contactName,
          email: vendor.email,
          phone: vendor.phone,
        },
      });
      const fileLabel = (po.poNumber || `PO-${po.id.slice(0, 8)}`).replace(/[^\w.-]/g, "_");
      attachments = [{ filename: `${fileLabel}.pdf`, content: pdf, contentType: "application/pdf" }];
    } catch (err) {
      console.warn(`[po] PDF generation failed for ${po.id}: ${(err as Error).message}`);
    }
    await sendMail({
      to: approver,
      subject: `PO approval needed — ${vendor.name} (₹${total.toLocaleString("en-IN")})`,
      text:
        `A new Purchase Order request awaits your approval in the Vendor Dashboard.\n\n` +
        `Vendor: ${vendor.name}\nItems: ${dto.lineItems.length}\nTotal: ₹${total.toLocaleString("en-IN")}\n\n` +
        `The full purchase order is attached as a PDF for your review.\n\n` +
        `Log in to Approve or Reject it:\n${appUrl()}\n`,
      attachments,
    });
  }
  return serialize(po);
}

/** Admin approves → create in Zoho + email the vendor, mark APPROVED. */
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
  const label = (result.poNumber || po.poNumber || `PO-${id.slice(0, 8)}`).replace(/[^\w.-]/g, "_");
  let attachments;
  try {
    // Prefer the official Zoho PDF; on failure build our Keystone PDF DIRECTLY —
    // going back through getPurchaseOrderPdf would re-run the Zoho retry loop
    // (zohoId is now persisted), doubling approval latency.
    const pdf = result.zohoId
      ? await fetchPurchaseOrderPdfWithRetry(result.zohoId)
      : await buildKeystonePoPdf(po, result.poNumber);
    attachments = [{ filename: `${label}.pdf`, content: pdf, contentType: "application/pdf" }];
  } catch (err) {
    console.warn(`[po] Zoho PDF unavailable for ${id}, falling back to generated: ${(err as Error).message}`);
    try {
      const pdf = await buildKeystonePoPdf(po, result.poNumber);
      attachments = [{ filename: `${label}.pdf`, content: pdf, contentType: "application/pdf" }];
    } catch (err2) {
      console.warn(`[po] no PDF at all for ${id}: ${(err2 as Error).message}`);
    }
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
