import { NextRequest } from "next/server";
import { DocumentSource } from "@shared";
import { handle } from "@/lib/server/http";
import { requireRole, HttpError } from "@/lib/server/auth";
import { prisma } from "@/lib/prisma";
import { uploadToVendorsCatalog, driveOAuthConfigured } from "@/lib/server/drive/vendors-catalog";
import { attachCatalogue } from "@/lib/server/catalogues";

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/** Upload a catalogue file to Google Drive and attach it to the vendor. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN", "PROCUREMENT_MEMBER");
    const vendor = await prisma.vendor.findUnique({ where: { id: params.id } });
    if (!vendor) throw new HttpError(404, "Vendor not found.");

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Please choose a file to upload.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "File is too large (max 15 MB).");

    if (!driveOAuthConfigured()) {
      throw new HttpError(503, "Drive uploads aren't configured (GOOGLE_DRIVE_* env vars missing).");
    }

    const title = String(form.get("title") ?? "").trim();
    const rename = String(form.get("filename") ?? "").trim();

    // If the user typed a Rename, that's the exact filename — don't prepend the
    // vendor name (that caused a doubled "Vendor - Vendor.pdf" look). Only when
    // Rename is left blank do we prefix the vendor name so an otherwise generic
    // original filename ("scan.pdf") stays identifiable in the shared Drive folder.
    const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
    const fileName = rename
      ? /\.[a-z0-9]+$/i.test(rename)
        ? rename
        : rename + ext
      : `${vendor.name.trim()} - ${file.name}`;

    const data = Buffer.from(await file.arrayBuffer());
    let uploaded;
    try {
      uploaded = await uploadToVendorsCatalog({
        fileName,
        mimeType: file.type || "application/octet-stream",
        data,
      });
    } catch (err) {
      throw new HttpError(502, `Drive upload failed: ${(err as Error).message}`);
    }

    return attachCatalogue(
      params.id,
      {
        title: title || rename || file.name,
        driveFileId: uploaded.fileId,
        viewUrl: uploaded.webViewLink || undefined,
      },
      user.userId,
      DocumentSource.DRIVE_SYNC,
    );
  });
}
