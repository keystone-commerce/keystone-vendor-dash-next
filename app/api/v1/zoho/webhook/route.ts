import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/server/zoho/service";

/**
 * Zoho Books webhook — Zoho calls this the moment a bill is created/updated, so
 * invoices sync in near-real-time (no polling). Configure a Zoho Workflow Rule
 * (module: Bills, on Create/Edit) with a Webhook action pointing at:
 *   https://<app>/api/v1/zoho/webhook?token=<ZOHO_WEBHOOK_SECRET>
 *
 * We use the webhook purely as a "something changed, sync now" trigger — no need
 * to trust/parse Zoho's payload. Auth is the shared ZOHO_WEBHOOK_SECRET.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.ZOHO_WEBHOOK_SECRET;
  if (!secret) return false; // not configured → reject (don't run open to the public)
  const fromQuery = req.nextUrl.searchParams.get("token");
  const fromHeader = req.headers.get("x-webhook-secret");
  return fromQuery === secret || fromHeader === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Respond immediately so Zoho's webhook doesn't hit a read timeout — a full
  // sync takes several seconds. The sync runs in the background.
  runSync(null).catch((err) =>
    console.warn(`[zoho webhook] background sync failed: ${(err as Error).message}`),
  );
  return NextResponse.json({ ok: true, queued: true, at: new Date().toISOString() });
}

// Zoho posts on the event; GET is handy for a quick manual test.
export const POST = handle;
export const GET = handle;
