/**
 * Drive filename parser. Filenames should look like:
 *   "<Vendor Name> - <Catalogue|Bill> - <YYYY-MM-DD> - <original.pdf>"
 * The separator may be hyphen, en dash, or em dash — with a space on at least one side.
 * This is lenient (a hyphen with NO surrounding spaces, e.g. "2026-01-01", does NOT split).
 */

const SEPARATOR_RE = /\s*[—–-]\s+|\s+[—–-]\s*/;

export type DriveFileKind = "catalogue" | "bill";

export interface ParsedDriveFilename {
  vendorToken: string;
  normalizedToken: string;
  kind: DriveFileKind;
  date: string | null;
  rest: string;
}

/** Lowercase, strip non-alphanumerics — the shape used to key remembered assignments. */
export function normalizeToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Returns null for files that should be ignored (test files, unparseable, wrong kind). */
export function parseDriveFilename(
  name: string,
  expectedKind: DriveFileKind,
): ParsedDriveFilename | null {
  if (!name || name.startsWith("_test_")) return null;

  const withoutExtension = name.replace(/\.[a-z0-9]+$/i, "");
  const parts = withoutExtension.split(SEPARATOR_RE).map((p) => p.trim());
  if (parts.length < 2) return null;

  const vendorToken = parts[0];
  const kindPart = parts[1]?.toLowerCase();
  const datePart = parts[2] ?? null;
  const rest = parts.slice(3).join(" - ").trim();

  if (!vendorToken) return null;

  let kind: DriveFileKind;
  if (kindPart === "catalogue" || kindPart === "catalog") kind = "catalogue";
  else if (kindPart === "bill") kind = "bill";
  else return null;

  if (kind !== expectedKind) return null;

  return {
    vendorToken,
    normalizedToken: normalizeToken(vendorToken),
    kind,
    date: datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null,
    rest,
  };
}

/** Build the canonical filename used when we upload to Drive on a user's behalf. */
export function buildDriveFilename(input: {
  vendorName: string;
  kind: DriveFileKind;
  uploadedAt: Date;
  originalFilename: string;
}): string {
  const kindLabel = input.kind === "catalogue" ? "Catalogue" : "Bill";
  const date = input.uploadedAt.toISOString().slice(0, 10);
  return `${input.vendorName} — ${kindLabel} — ${date} — ${input.originalFilename}`;
}
