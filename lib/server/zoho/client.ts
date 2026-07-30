import { apiBase, getAccessToken, invalidateToken, invoiceSource, organizationId, zohoDc } from "./auth";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ZohoBill {
  zohoId: string;
  billNumber: string;
  vendorId: string;
  vendorName: string;
  date: string;
  dueDate: string | null;
  total: number;
  status: string;
  viewUrl: string | null;
}

export interface CreatePoInput {
  vendorId: string;
  poNumber?: string | null;
  date?: string;
  lineItems: { name: string; quantity: number; rate: number; hsn?: string }[];
}

let cachedPurchaseAccountId: string | null = null;

/** Authed JSON request against the Books API; validates Zoho's `code` field. */
async function api(method: string, path: string, body?: unknown): Promise<any> {
  const token = await getAccessToken();
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${apiBase()}${path}${sep}organization_id=${organizationId()}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json && typeof json.code === "number" && json.code !== 0)) {
    throw new Error(`Zoho ${method} ${path} failed (${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

export async function healthCheck(): Promise<{ ok: boolean; message: string | null }> {
  try {
    await getAccessToken();
    return { ok: true, message: null };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

function mapRecord(r: any, module: "bills" | "invoices"): ZohoBill | null {
  const zohoId = module === "bills" ? r.bill_id : r.invoice_id;
  if (!zohoId) return null;
  return {
    zohoId: String(zohoId),
    billNumber: String((module === "bills" ? r.bill_number : r.invoice_number) ?? ""),
    vendorId: String(r.vendor_id ?? r.customer_id ?? ""),
    vendorName: String(r.vendor_name ?? r.customer_name ?? ""),
    date: r.date ?? new Date().toISOString().slice(0, 10),
    dueDate: r.due_date || null,
    total: Number(r.total ?? 0),
    status: String(r.status ?? "open"),
    viewUrl: `https://books.zoho.${zohoDc()}/app#/${module}/${zohoId}`,
  };
}

export async function listBills(): Promise<ZohoBill[]> {
  const module = invoiceSource();
  const results: ZohoBill[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const json = await api("GET", `/${module}?page=${page}&per_page=200`);
    for (const r of json?.[module] ?? []) {
      const mapped = mapRecord(r, module);
      if (mapped) results.push(mapped);
    }
    hasMore = Boolean(json?.page_context?.has_more_page);
    page += 1;
    if (page > 100) break;
  }
  return results;
}

export async function fetchInvoicePdf(zohoId: string, isRetry = false): Promise<Buffer> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ accept: "pdf", organization_id: organizationId() });
  const res = await fetch(`${apiBase()}/${invoiceSource()}/${zohoId}?${params.toString()}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (res.status === 401 && !isRetry) {
    invalidateToken();
    return fetchInvoicePdf(zohoId, true);
  }
  if (!res.ok) throw new Error(`Zoho PDF fetch failed (${res.status}) for ${zohoId}.`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchPurchaseOrderPdf(zohoId: string, isRetry = false): Promise<Buffer> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ accept: "pdf", organization_id: organizationId() });
  const res = await fetch(`${apiBase()}/purchaseorders/${zohoId}?${params.toString()}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (res.status === 401 && !isRetry) {
    invalidateToken();
    return fetchPurchaseOrderPdf(zohoId, true);
  }
  if (!res.ok) throw new Error(`Zoho PO PDF fetch failed (${res.status}) for ${zohoId}.`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Fetch the official Zoho PO PDF, retrying a few times. Right after a PO is created
 * Zoho occasionally isn't ready to render the PDF yet, so a single attempt can fail
 * and (upstream) fall back to our pre-approval PDF. Retrying gives Zoho a moment.
 */
export async function fetchPurchaseOrderPdfWithRetry(
  zohoId: string,
  attempts = 3,
  delayMs = 1500,
): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPurchaseOrderPdf(zohoId);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Zoho PO PDF fetch failed.");
}

export async function createInvoice(input: {
  customerId: string;
  date?: string;
  dueDate?: string;
  referenceNumber?: string;
  lineItems: { name: string; rate: number; quantity: number }[];
}): Promise<{ zohoId: string; billNumber: string; total: number }> {
  const json = await api("POST", `/${invoiceSource()}`, {
    customer_id: input.customerId,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    ...(input.dueDate ? { due_date: input.dueDate } : {}),
    ...(input.referenceNumber ? { reference_number: input.referenceNumber } : {}),
    line_items: input.lineItems.map((li) => ({ name: li.name, rate: li.rate, quantity: li.quantity })),
  });
  const rec = json?.invoice ?? json?.bill ?? {};
  return {
    zohoId: String(rec.invoice_id ?? rec.bill_id ?? ""),
    billNumber: String(rec.invoice_number ?? rec.bill_number ?? ""),
    total: Number(rec.total ?? 0),
  };
}

async function getPurchaseAccountId(): Promise<string> {
  if (cachedPurchaseAccountId) return cachedPurchaseAccountId;
  const json = await api("GET", "/chartofaccounts");
  const accts: any[] = json?.chartofaccounts ?? [];
  const pick =
    accts.find((a) => a.account_type === "cost_of_goods_sold") ??
    accts.find((a) => /cost of goods/i.test(a.account_name)) ??
    accts.find((a) => a.account_type === "expense");
  if (!pick) throw new Error("No expense/COGS account found for purchasable items.");
  cachedPurchaseAccountId = String(pick.account_id);
  return cachedPurchaseAccountId;
}

async function resolvePurchasableItemId(
  name: string,
  rate: number,
  hsn: string | undefined,
  purchaseAccountId: string,
): Promise<string> {
  const found = await api("GET", `/items?search_text=${encodeURIComponent(name)}`);
  const match = (found?.items ?? []).find(
    (i: any) => i.name?.toLowerCase() === name.toLowerCase() && i.can_be_purchased,
  );
  if (match) return String(match.item_id);
  const created = await api("POST", "/items", {
    name,
    rate,
    purchase_rate: rate,
    can_be_purchased: true,
    can_be_sold: false,
    product_type: "goods",
    purchase_account_id: purchaseAccountId,
    ...(hsn ? { hsn_or_sac: hsn } : {}),
  });
  return String(created.item.item_id);
}

export async function createPurchaseOrder(
  input: CreatePoInput,
): Promise<{ zohoId: string; poNumber: string; total: number; status: string }> {
  const purchaseAccountId = await getPurchaseAccountId();
  const lineItems = [];
  for (const li of input.lineItems) {
    const itemId = await resolvePurchasableItemId(li.name, li.rate, li.hsn, purchaseAccountId);
    // NOTE: Zoho stores HSN on the item master (set during item creation above), not
    // on the purchase-order line. Sending hsn_or_sac here returns 400 "Invalid Element
    // hsn_or_sac", so it's intentionally omitted from the PO line payload.
    lineItems.push({
      item_id: itemId,
      rate: li.rate,
      quantity: li.quantity,
    });
  }
  const json = await api("POST", "/purchaseorders", {
    vendor_id: input.vendorId,
    date: input.date ?? new Date().toISOString().slice(0, 10),
    ...(input.poNumber ? { purchaseorder_number: input.poNumber } : {}),
    line_items: lineItems,
  });
  const po = json?.purchaseorder ?? {};
  return {
    zohoId: String(po.purchaseorder_id ?? ""),
    poNumber: String(po.purchaseorder_number ?? ""),
    total: Number(po.total ?? 0),
    status: String(po.status ?? "draft"),
  };
}

export async function emailPurchaseOrder(
  zohoId: string,
  opts: { toMailIds: string[]; subject?: string; body?: string },
): Promise<void> {
  await api("POST", `/purchaseorders/${zohoId}/email`, {
    send_from_org_email_id: true,
    to_mail_ids: opts.toMailIds,
    subject: opts.subject ?? "Purchase Order",
    body: opts.body ?? "Please find the attached purchase order.",
  });
}

export async function listVendors(): Promise<{ id: string; name: string }[]> {
  const json = await api("GET", "/contacts?contact_type=vendor&per_page=200");
  return (json?.contacts ?? []).map((c: any) => ({
    id: String(c.contact_id),
    name: String(c.contact_name ?? c.company_name ?? ""),
  }));
}

export async function createVendor(input: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<{ id: string; name: string }> {
  const body: any = { contact_name: input.name, contact_type: "vendor" };
  if (input.email || input.phone) {
    body.contact_persons = [
      {
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        is_primary_contact: true,
      },
    ];
  }
  const json = await api("POST", "/contacts", body);
  const c = json?.contact ?? {};
  return { id: String(c.contact_id ?? ""), name: String(c.contact_name ?? input.name) };
}
