// Zoho OAuth token manager (self-client refresh-token flow). Caches the access
// token in the module (per serverless instance) and refreshes near expiry.

interface Cached {
  accessToken: string;
  expiresAt: number;
}
let cached: Cached | null = null;
let inflight: Promise<string> | null = null;

export const zohoDc = () => process.env.ZOHO_DC ?? "in";
export const accountsBase = () => `https://accounts.zoho.${zohoDc()}`;
export const apiBase = () => `https://www.zohoapis.${zohoDc()}/books/v3`;
export const organizationId = () => process.env.ZOHO_ORGANIZATION_ID ?? "";
/**
 * Which Zoho module the dashboard syncs from. "bills" (supplier payables) is the
 * procurement default — an approved PO is converted to a Bill in Zoho, which syncs
 * back here. Set ZOHO_INVOICE_SOURCE="invoices" to read the customer side instead.
 */
export const syncModule = (): "bills" | "invoices" =>
  process.env.ZOHO_INVOICE_SOURCE === "invoices" ? "invoices" : "bills";

export function invalidateToken() {
  cached = null;
}

export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cached && cached.expiresAt > now + 60_000) return cached.accessToken;
  if (inflight) return inflight;
  inflight = refresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refresh(): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Zoho credentials missing (ZOHO_CLIENT_ID / SECRET / REFRESH_TOKEN).");
  }
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${accountsBase()}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Zoho token refresh failed (${res.status}): ${await res.text().catch(() => "")}`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (data.error || !data.access_token) {
    throw new Error(`Zoho token refresh error: ${data.error ?? "no access_token"}`);
  }
  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}
