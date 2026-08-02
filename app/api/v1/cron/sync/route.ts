import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/lib/server/zoho/service";

// A full Zoho sync can take several seconds and grows with bill volume.
export const maxDuration = 60;

/**
 * Scheduled Zoho bill sync — called by Vercel Cron (see vercel.json), so
 * procurement never has to click "Sync bills".
 *
 * Protected by CRON_SECRET: Vercel automatically sends `Authorization: Bearer
 * <CRON_SECRET>` on cron requests when that env var is set. If it's set, we
 * require a match so the endpoint can't be triggered by the public.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSync(null);
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
