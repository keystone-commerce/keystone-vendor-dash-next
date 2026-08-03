import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/server/auth";
import { getBillPdf } from "@/lib/server/zoho/service";

export async function GET(req: NextRequest, { params }: { params: { zohoId: string } }) {
  try {
    requireUser(req);
    const download = req.nextUrl.searchParams.get("download") === "true";
    const pdf = await getBillPdf(params.zohoId);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="bill_${params.zohoId}.pdf"`,
      },
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    return NextResponse.json({ statusCode: status, message: (err as Error).message }, { status });
  }
}
