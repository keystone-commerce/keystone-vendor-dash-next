import * as client from "./zoho/client";

/**
 * Create a PO in Zoho for the approval flow. Real Zoho when ZOHO_ENABLED=true;
 * otherwise a mock so the workflow still runs in demo mode.
 */
export interface CreateZohoPoInput {
  zohoVendorId: string;
  poNumber?: string | null;
  /** gstPercent is required by GST-registered Zoho orgs — it resolves to the line's tax_id. */
  lineItems: { name: string; quantity: number; rate: number; hsn?: string; gstPercent?: number }[];
  emailTo?: string[];
}

export interface CreateZohoPoResult {
  zohoId: string | null;
  poNumber: string;
  total: number;
}

let mockCounter = 5000;

export async function createZohoPurchaseOrder(input: CreateZohoPoInput): Promise<CreateZohoPoResult> {
  const total = input.lineItems.reduce((s, li) => s + (li.rate || 0) * (li.quantity || 0), 0);

  if (process.env.ZOHO_ENABLED !== "true") {
    return { zohoId: null, poNumber: input.poNumber || `PO-MOCK-${mockCounter++}`, total };
  }

  const po = await client.createPurchaseOrder({
    vendorId: input.zohoVendorId,
    poNumber: input.poNumber,
    lineItems: input.lineItems,
  });

  if (input.emailTo?.length) {
    try {
      await client.emailPurchaseOrder(po.zohoId, {
        toMailIds: input.emailTo,
        subject: `Purchase Order ${po.poNumber}`,
        body: `Please find attached Purchase Order ${po.poNumber}.`,
      });
    } catch (err) {
      console.warn(`[zoho] PO ${po.poNumber} created but vendor email failed: ${(err as Error).message}`);
    }
  }
  return { zohoId: po.zohoId, poNumber: po.poNumber, total: po.total };
}
