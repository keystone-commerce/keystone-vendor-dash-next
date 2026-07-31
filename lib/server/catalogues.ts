import { DocumentSource } from "@shared";
import { prisma } from "@/lib/prisma";
import { HttpError } from "./auth";
import { audit } from "./audit";
import { autoAdvanceOnDocumentAttach } from "./stage-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

function serialize(c: any) {
  return {
    ...c,
    uploadedAt: c.uploadedAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    items: (c.items ?? []).map((it: any) => ({ ...it, createdAt: it.createdAt.toISOString() })),
  };
}

export interface AttachCatalogueInput {
  title: string;
  driveFileId?: string;
  viewUrl?: string;
  uploadedAt?: string | Date;
  items?: { name: string; description?: string; unitPrice: number; unit?: string; hsn?: string }[];
}

/** Attach a catalogue to a vendor (with optional itemized products). Auto-advances stage. */
export async function attachCatalogue(
  vendorId: string,
  dto: AttachCatalogueInput,
  actorUserId: string | null,
  source: DocumentSource = DocumentSource.MANUAL_UPLOAD,
) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new HttpError(404, "Vendor not found.");

  // A title is the only thing that identifies a catalogue in the UI, so an empty one
  // creates a blank, meaningless row. Drive uploads always supply one (the filename);
  // this guards the "add manually" form.
  const title = (dto.title ?? "").trim();
  if (!title) throw new HttpError(400, "Catalogue title is required.");

  // A catalogue has to carry something: either a file (Drive upload) or at least one
  // product. Without either it's an empty row with nothing to open and nothing to
  // price a PO from.
  const namedItems = (dto.items ?? []).filter((it) => (it.name ?? "").trim());
  if (!dto.driveFileId && namedItems.length === 0) {
    throw new HttpError(400, "Add at least one product, or upload a catalogue file instead.");
  }

  const uploadedAt =
    dto.uploadedAt instanceof Date
      ? dto.uploadedAt
      : dto.uploadedAt
        ? new Date(dto.uploadedAt)
        : new Date();

  const catalogue = await prisma.$transaction(async (tx) => {
    const created = await tx.catalogue.create({
      data: {
        vendorId,
        title,
        driveFileId: dto.driveFileId,
        viewUrl: dto.viewUrl,
        uploadedAt,
        source,
        items: dto.items?.length
          ? {
              create: dto.items.map((it) => ({
                name: it.name,
                description: it.description,
                unitPrice: it.unitPrice,
                unit: it.unit,
                hsn: it.hsn,
              })),
            }
          : undefined,
      },
      include: { items: true },
    });
    await autoAdvanceOnDocumentAttach(vendorId, "catalogue", actorUserId, tx);
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "CATALOGUE_ATTACH",
        entityType: "Catalogue",
        entityId: created.id,
        metadata: { vendorId, title: created.title, source, itemCount: created.items.length },
      },
    });
    return created;
  });

  return serialize(catalogue);
}

export async function removeCatalogue(id: string, actorUserId: string | null) {
  const existing = await prisma.catalogue.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Catalogue not found.");
  await prisma.catalogue.delete({ where: { id } });
  await audit({
    userId: actorUserId,
    action: "CATALOGUE_DELETE",
    entityType: "Catalogue",
    entityId: id,
    metadata: { vendorId: existing.vendorId },
  });
  return { success: true };
}

export async function addCatalogueItem(
  catalogueId: string,
  input: { name: string; description?: string; unitPrice: number; unit?: string; hsn?: string },
  actorUserId: string | null,
) {
  const cat = await prisma.catalogue.findUnique({ where: { id: catalogueId } });
  if (!cat) throw new HttpError(404, "Catalogue not found.");
  const item = await prisma.catalogueItem.create({ data: { catalogueId, ...input } });
  await audit({
    userId: actorUserId,
    action: "CATALOGUE_ITEM_ADD",
    entityType: "CatalogueItem",
    entityId: item.id,
    metadata: { catalogueId, name: item.name },
  });
  return { ...item, createdAt: item.createdAt.toISOString() };
}

export async function removeCatalogueItem(itemId: string, actorUserId: string | null) {
  const existing = await prisma.catalogueItem.findUnique({ where: { id: itemId } });
  if (!existing) throw new HttpError(404, "Catalogue item not found.");
  await prisma.catalogueItem.delete({ where: { id: itemId } });
  await audit({
    userId: actorUserId,
    action: "CATALOGUE_ITEM_DELETE",
    entityType: "CatalogueItem",
    entityId: itemId,
    metadata: { catalogueId: existing.catalogueId },
  });
  return { success: true };
}
