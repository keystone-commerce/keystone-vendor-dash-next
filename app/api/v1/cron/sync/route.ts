import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/server/zoho/service";

// A full Zoho sync can take several seconds and grows with bill volume.
export const maxDuration = 60;

/**
 * Scheduled Zoho bill sync — called by Vercel Cron (see vercel.json), so
 * procurement never has to click "Sync bills".
 *
 * Protected by CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron
 * requests. Fails CLOSED — a missing secret returns 503 rather than running the sync.
 *
 * This used to be `if (secret && ...)`, which skipped the check entirely when the
 * variable was unset, leaving the endpoint publicly callable: anyone could trigger a
 * full Zoho sync repeatedly, burning Zoho's rate limit and writing to the database.
 * An unset secret is a misconfiguration, so say so loudly instead of running unguarded.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET is not set — refusing to run the sync unauthenticated.");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 },
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSync(null);
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
