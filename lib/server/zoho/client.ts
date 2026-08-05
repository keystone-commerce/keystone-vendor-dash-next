import { apiBase, getAccessToken, invalidateToken, syncModule, organizationId, zohoDc } from "./auth";

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
  /**
   * Supplier's GSTIN. Its first two digits are the state code, which decides whether the
   * line carries CGST+SGST or IGST — see resolveTaxId(). Optional: when it's missing the
   * treatment is assumed intra-state and corrected from Zoho's own answer if wrong.
   */
  vendorGstin?: string | null;
  /** gstPercent drives the Zoho line's tax_id — see resolveTaxId(). */
  lineItems: { name: string; quantity: number; rate: number; hsn?: string; gstPercent?: number }[];
}

/** Keystone's own state — the place of supply every PO is raised against. */
const KEYSTONE_STATE_CODE = "29"; // Karnataka

/**
 * Inter-state supply? Decided by the supplier's GSTIN state code, the same rule the PO PDF
 * uses for its CGST/SGST-vs-IGST split, so the document and Zoho agree.
 *
 * With no usable GSTIN this returns false (assume intra-state). That's a guess, and
 * createPurchaseOrder corrects it from Zoho's response rather than relying on it.
 */
function isInterState(gstin: string | null | undefined): boolean {
  const code = (gstin ?? "").trim().slice(0, 2);
  if (!/^\d{2}$/.test(code)) return false;
  return code !== KEYSTONE_STATE_CODE;
}

let cachedPurchaseAccountId: string | null = null;

/** `type` is Zoho's tax_type: for India one of igst | cgst | sgst | nil | cess, or "" for a group. */
type OrgTax = { id: string; name: string; percent: number; type: string };
let cachedTaxes: { at: number; taxes: OrgTax[] } | null = null;

/**
 * How long a tax list is trusted. Short on purpose: when a rate is missing the error
 * tells the admin to add it in Zoho, and they'll retry within a minute or two. An
 * indefinite cache would keep rejecting the PO with a list that's no longer true, and
 * an org that switches GST on after an empty response was cached would keep having its
 * tax_id omitted — both only resolving on a process restart.
 */
const TAX_CACHE_TTL_MS = 60_000;

/**
 * The organisation's configured taxes, by percentage.
 *
 * A GST-registered Zoho org refuses a purchase order whose lines don't declare a tax:
 * `{"code":110802,"message":"Specify either a Tax or Tax Exemption or Reverse Charge."}`.
 * So each line needs a `tax_id`, and the id is org-specific — it has to be looked up
 * rather than hardcoded.
 *
 * Only a successful response is cached, so a transient failure doesn't convince this
 * instance that the org has no taxes.
 */
async function orgTaxes(): Promise<OrgTax[]> {
  if (cachedTaxes && Date.now() - cachedTaxes.at < TAX_CACHE_TTL_MS) return cachedTaxes.taxes;
  const json = await api("GET", "/settings/taxes");
  const taxes: OrgTax[] = (json?.taxes ?? [])
    .map((t: any) => ({
      id: String(t.tax_id ?? ""),
      name: String(t.tax_name ?? ""),
      percent: Number(t.tax_percentage ?? 0),
      type: String(t.tax_type ?? "").toLowerCase(),
    }))
    .filter((t: OrgTax) => t.id);
  cachedTaxes = { at: Date.now(), taxes };
  return taxes;
}

/**
 * Zoho tax id for a GST percentage, or null when the org isn't taxed at all.
 *
 * The percentage alone isn't enough. Indian GST splits by where the supplier is:
 *   - intra-state (supplier in Karnataka, same as Keystone) -> CGST + SGST, which Zoho
 *     models as a tax *group* at the full rate (e.g. "GST18" = CGST 9 + SGST 9)
 *   - inter-state -> a single IGST tax at the full rate
 * Both read as "18%", so matching on percentage alone picks one at random and Zoho answers
 * `{"code":3032,"message":"IGST has to be applied as this is an interstate transaction"}`.
 * `tax_type` is the discriminator: igst | cgst | sgst | nil | cess, empty for a group.
 *
 * Errors list the org's actual taxes with names and types, because when this goes wrong
 * the only useful next step is seeing what Zoho actually has configured.
 */
async function resolveTaxId(
  gstPercent: number | undefined,
  interState: boolean,
): Promise<string | null> {
  const taxes = await orgTaxes();
  // Not a GST org (no taxes configured) — lines then carry no tax, which is what such an
  // org expects and is how this worked before.
  if (!taxes.length) return null;

  const pct = Number(gstPercent ?? 0);
  const atRate = taxes.filter((t) => Math.abs(t.percent - pct) < 0.001);

  const isIgst = (t: OrgTax) => t.type === "igst" || /igst/i.test(t.name);
  // A single CGST or SGST line is never right on its own — intra-state needs the group
  // that carries both, which Zoho reports with no tax_type.
  const isHalfOfPair = (t: OrgTax) => t.type === "cgst" || t.type === "sgst";

  const pick = interState
    ? atRate.find(isIgst)
    : (atRate.find((t) => !isIgst(t) && !isHalfOfPair(t)) ?? atRate.find((t) => !isIgst(t)));

  if (pick) return pick.id;

  const describe = () =>
    taxes
      .map((t) => `${t.name || "(unnamed)"} ${t.percent}%${t.type ? ` [${t.type}]` : " [group]"}`)
      .join(", ");

  // Zoho wants a tax_exemption_id for a genuinely untaxed line, which is an org-level
  // record the app has no way to choose. Say that plainly instead of quoting rates.
  if (pct === 0) {
    throw new Error(
      `A purchase order line has no GST %, and this Zoho organisation is GST-registered — ` +
        `it won't accept an untaxed line without a tax exemption, which has to be set in ` +
        `Zoho. Put a GST % on every line. The org has: ${describe()}.`,
    );
  }

  const kind = interState ? "IGST" : "CGST+SGST";
  throw new Error(
    `This Zoho organisation has no ${kind} tax at ${pct}%, which is what a ` +
      `${interState ? "inter" : "intra"}-state supply needs. Configured taxes: ${describe()}. ` +
      `Add the missing rate in Zoho Books (Settings → Taxes → GST), or use a rate that exists.`,
  );
}

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

// NOTE: the snake_case keys below are Zoho's own API field names — they are the wire
// format and must stay as Zoho spells them, even though we call the records "bills"
// internally. `module` is still both values because ZOHO_INVOICE_SOURCE can select
// either side of the ledger.
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
  const module = syncModule();
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

export async function fetchBillPdf(zohoId: string, isRetry = false): Promise<Buffer> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ accept: "pdf", organization_id: organizationId() });
  const res = await fetch(`${apiBase()}/${syncModule()}/${zohoId}?${params.toString()}`, {
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
  });
  if (res.status === 401 && !isRetry) {
    invalidateToken();
    return fetchBillPdf(zohoId, true);
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

export async function createBill(input: {
  /** Zoho contact id — a vendor when posting to /bills, a customer for /invoices. */
  contactId: string;
  date?: string;
  dueDate?: string;
  referenceNumber?: string;
  lineItems: { name: string; rate: number; quantity: number }[];
}): Promise<{ zohoId: string; billNumber: string; total: number }> {
  const module = syncModule();
  const json = await api("POST", `/${module}`, {
    // Zoho names the counterparty differently per module: a Bill is owed to a vendor
    // (`vendor_id`), an Invoice is owed by a customer (`customer_id`). Posting
    // customer_id to /bills is rejected, so this has to follow the module.
    ...(module === "bills" ? { vendor_id: input.contactId } : { customer_id: input.contactId }),
    date: input.date ?? new Date().toISOString().slice(0, 10),
    ...(input.dueDate ? { due_date: input.dueDate } : {}),
    ...(input.referenceNumber ? { reference_number: input.referenceNumber } : {}),
    line_items: input.lineItems.map((li) => ({ name: li.name, rate: li.rate, quantity: li.quantity })),
  });
  // Again: Zoho's own response keys — "bill" or "invoice" depending on the module.
  const rec = json?.bill ?? json?.invoice ?? {};
  return {
    zohoId: String(rec.bill_id ?? rec.invoice_id ?? ""),
    billNumber: String(rec.bill_number ?? rec.invoice_number ?? ""),
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

/** Zoho rejects `search_text` of 100+ chars, and caps item names at 100 too. */
const ZOHO_ITEM_NAME_MAX = 100;
const ZOHO_SEARCH_MAX = 90; // comfortably under Zoho's 100-char limit

async function resolvePurchasableItemId(
  name: string,
  rate: number,
  hsn: string | undefined,
  purchaseAccountId: string,
): Promise<string> {
  // Zoho errors with "search_text has less than 100 characters" on a long product
  // name, so search on a prefix and still compare the FULL name in the results.
  const itemName = name.slice(0, ZOHO_ITEM_NAME_MAX);
  const searchText = itemName.slice(0, ZOHO_SEARCH_MAX);

  const found = await api("GET", `/items?search_text=${encodeURIComponent(searchText)}`);
  const match = (found?.items ?? []).find(
    (i: any) => i.name?.toLowerCase() === itemName.toLowerCase() && i.can_be_purchased,
  );
  if (match) return String(match.item_id);
  const created = await api("POST", "/items", {
    name: itemName, // Zoho rejects names longer than this
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

  // Resolve every line's tax BEFORE touching items. resolvePurchasableItemId() can POST
  // /items, which creates a product in the customer's Zoho — an irreversible write. If a
  // later line then failed tax resolution, the purchase order would be rejected while the
  // items it had already created stayed behind, and each retry would add more. Taxes are
  // read-only and cheap to check, so they're validated up front: either the whole order
  // can be built or nothing is created.
  let interState = isInterState(input.vendorGstin);
  const resolveAll = async (inter: boolean) => {
    const ids: (string | null)[] = [];
    for (const li of input.lineItems) ids.push(await resolveTaxId(li.gstPercent, inter));
    return ids;
  };
  let taxIds = await resolveAll(interState);

  // Items are resolved once and reused, so a tax-treatment retry cannot create them twice.
  const itemIds: string[] = [];
  for (const li of input.lineItems) {
    itemIds.push(await resolvePurchasableItemId(li.name, li.rate, li.hsn, purchaseAccountId));
  }

  const buildLines = (ids: (string | null)[]) =>
    input.lineItems.map((li, i) => ({
      // NOTE: Zoho stores HSN on the item master (set during item creation above), not
      // on the purchase-order line. Sending hsn_or_sac here returns 400 "Invalid Element
      // hsn_or_sac", so it's intentionally omitted from the PO line payload.
      item_id: itemIds[i],
      rate: li.rate,
      quantity: li.quantity,
      // tax_id is sent only when the org actually has taxes configured: a GST-registered
      // org rejects untaxed lines with 110802, while an org with no taxes has no id to
      // send. So it follows the organisation rather than being assumed either way.
      ...(ids[i] ? { tax_id: ids[i] } : {}),
    }));

  const post = (ids: (string | null)[]) =>
    api("POST", "/purchaseorders", {
      vendor_id: input.vendorId,
      date: input.date ?? new Date().toISOString().slice(0, 10),
      ...(input.poNumber ? { purchaseorder_number: input.poNumber } : {}),
      line_items: buildLines(ids),
    });

  let json;
  try {
    json = await post(taxIds);
  } catch (err) {
    // Zoho is the authority on place of supply — it knows the vendor's state from the
    // contact record, which may be more accurate than the GSTIN we hold (or we may hold
    // none). Codes 3032/3062 mean it wanted the other treatment, so flip and retry once
    // rather than making the user fix data to satisfy a guess we made.
    const msg = (err as Error).message;
    const wrongTreatment =
      /"code":\s*(3032|3062)/.test(msg) || /IGST has to be applied|CGST.*SGST.*applied/i.test(msg);
    if (!wrongTreatment) throw err;

    interState = !interState;
    console.warn(
      `[zoho] Zoho wants a ${interState ? "inter" : "intra"}-state tax treatment for this PO; retrying.`,
    );
    taxIds = await resolveAll(interState);
    json = await post(taxIds);
  }
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

export interface ZohoVendorSummary {
  id: string;
  name: string;
  /** Primary contact's name, assembled from first/last name when Zoho has them. */
  contactName?: string;
  email?: string;
  /** Digits only. Zoho stores things like "+91 98765 43210". */
  phone?: string;
  gstin?: string;
  billingAddress?: string;
  shippingAddress?: string;
}

/**
 * Every vendor contact in the Zoho organisation.
 *
 * Paged like listBills — the contacts endpoint caps a page at 200, and silently
 * returning only the first page is the bug that made the bill sync look broken.
 */
export async function listVendors(): Promise<ZohoVendorSummary[]> {
  const out: ZohoVendorSummary[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const json = await api("GET", `/contacts?contact_type=vendor&per_page=200&page=${page}`);
    for (const c of json?.contacts ?? []) {
      // Zoho keeps the person's name split across first/last on the contact itself,
      // and separately on contact_persons; the top-level pair is what the list returns.
      const person = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
      // Take the last 10 digits so a country code or spacing doesn't fail our 10-digit
      // rule; anything that doesn't yield 10 is treated as absent.
      const digits = String(c.mobile || c.phone || "").replace(/\D/g, "");
      const phone = digits.length >= 10 ? digits.slice(-10) : "";

      out.push({
        id: String(c.contact_id),
        name: String(c.contact_name ?? c.company_name ?? ""),
        contactName: person || undefined,
        email: String(c.email ?? "").trim() || undefined,
        phone: phone || undefined,
        gstin: String(c.gst_no ?? "").trim().toUpperCase() || undefined,
      });
    }
    hasMore = Boolean(json?.page_context?.has_more_page);
    page += 1;
    if (page > 50) break; // 10,000 contacts — a runaway guard, not a real limit
  }
  return out;
}

/** Flatten a Zoho address object into the single line we store. */
function fromZohoAddress(a: any): string | undefined {
  if (!a) return undefined;
  const parts = [a.attention, a.address, a.street2, a.city, a.state, a.zip]
    .map((p: unknown) => String(p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/**
 * Fill in the fields the contacts *list* doesn't return.
 *
 * Verified against a live org: the list response carries contact_id, contact_name,
 * first_name/last_name, email, phone and mobile — but **not** contact_persons, not
 * billing/shipping addresses, and not gst_no. Only GET /contacts/{id} has those, so a
 * list-only import would create every vendor with a blank contact person, no GSTIN and no
 * address, leaving all of them unable to raise a PO.
 *
 * One request per vendor, so the caller throttles.
 */
export async function fetchVendorDetail(contactId: string): Promise<Partial<ZohoVendorSummary>> {
  const json = await api("GET", `/contacts/${contactId}`);
  const c = json?.contact ?? {};

  // The person's name lives on the primary contact person, not on the contact itself —
  // the top-level first_name/last_name come back empty even when a person is recorded.
  const persons: any[] = Array.isArray(c.contact_persons) ? c.contact_persons : [];
  const primary = persons.find((p) => p.is_primary_contact) ?? persons[0] ?? {};
  const person =
    [primary.first_name, primary.last_name].filter(Boolean).join(" ").trim() ||
    [c.first_name, c.last_name].filter(Boolean).join(" ").trim();

  const digits = String(primary.mobile || primary.phone || c.mobile || c.phone || "").replace(/\D/g, "");

  return {
    contactName: person || undefined,
    email: String(primary.email || c.email || "").trim() || undefined,
    phone: digits.length >= 10 ? digits.slice(-10) : undefined,
    gstin: String(c.gst_no ?? "").trim().toUpperCase() || undefined,
    billingAddress: fromZohoAddress(c.billing_address),
    shippingAddress: fromZohoAddress(c.shipping_address),
  };
}

let cachedOrgGstEnabled: boolean | null = null;

/**
 * Whether this Zoho organisation is registered for GST.
 *
 * `gst_no` and `gst_treatment` only exist on a contact when the *organisation* has GST
 * enabled (India edition, Settings → Taxes → GST). Sending them to an org without it is
 * rejected with `{"code":8,"message":"Invalid Element gst_no"}` — a 400, not a permission
 * error — which fails the whole vendor creation. So ask once and cache, the same way the
 * purchase account is cached.
 *
 * Fails open to `false`: skipping the GST fields still creates a usable vendor, whereas
 * sending them to an org that can't accept them creates nothing at all.
 */
async function orgSupportsGst(): Promise<boolean> {
  if (cachedOrgGstEnabled !== null) return cachedOrgGstEnabled;
  try {
    const json = await api("GET", `/organizations/${organizationId()}`);
    const org = json?.organization ?? {};
    // Only a successful answer is cached. Caching a failure would mean one transient
    // Zoho error permanently strips GST off every vendor created by this instance,
    // long after Zoho recovered — and nothing would report it.
    cachedOrgGstEnabled = Boolean(
      org.is_registered_for_gst ?? org.tax_settings?.is_tax_registered ?? false,
    );
    return cachedOrgGstEnabled;
  } catch (err) {
    console.warn(
      `[zoho] couldn't read the organisation's GST setting, omitting GST fields for this request: ${(err as Error).message}`,
    );
    return false; // this request only — left uncached so the next one retries
  }
}

/**
 * Zoho caps a contact address line at 500 characters and rejects anything longer, so a
 * free-text address is trimmed rather than allowed to fail the whole vendor creation.
 */
function toZohoAddress(text: string | undefined, stateName?: string) {
  const address = (text ?? "").trim();
  if (!address) return undefined;
  return {
    address: address.slice(0, 500),
    ...(stateName ? { state: stateName } : {}),
    country: "India",
  };
}

export async function createVendor(input: {
  name: string;
  email?: string;
  phone?: string;
  /** 15-char GSTIN. Its presence is what marks the vendor GST-registered in Zoho. */
  gstin?: string;
  /** State name derived from the GSTIN's leading 2-digit code. */
  gstStateName?: string;
  billingAddress?: string;
  shippingAddress?: string;
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

  // GST, only if this organisation is registered for it — see orgSupportsGst().
  // `gst_treatment` is what Zoho displays as registered/unregistered: "business_gst"
  // means GST-registered and requires gst_no, so without a GSTIN the vendor has to be
  // "business_none" or Zoho rejects the request for a missing number.
  const gstin = (input.gstin ?? "").trim().toUpperCase();
  if (await orgSupportsGst()) {
    if (gstin) {
      body.gst_no = gstin;
      body.gst_treatment = "business_gst";
    } else {
      body.gst_treatment = "business_none";
    }
  }

  const billing = toZohoAddress(input.billingAddress, input.gstStateName);
  const shipping = toZohoAddress(input.shippingAddress, input.gstStateName);
  if (billing) body.billing_address = billing;
  // Vendors commonly dispatch from the billing address; fall back so the Zoho contact
  // isn't left with an empty shipping address when only one was captured.
  if (shipping ?? billing) body.shipping_address = shipping ?? billing;

  const json = await api("POST", "/contacts", body);
  const c = json?.contact ?? {};
  return { id: String(c.contact_id ?? ""), name: String(c.contact_name ?? input.name) };
}
