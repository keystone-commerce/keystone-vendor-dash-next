/**
 * Minimal RFC-4180 CSV reader.
 *
 * Hand-rolled rather than adding a dependency, but it does handle the cases that break
 * naive `split(",")` on real spreadsheet exports:
 *   - quoted fields containing commas, newlines or quotes ("" escapes a quote)
 *   - CRLF as well as LF line endings
 *   - a UTF-8 BOM, which Excel writes and which would otherwise corrupt the first header
 *
 * Returns rows of raw strings; interpreting them is the caller's job.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Treat CRLF as one break, and don't emit a row for a trailing newline.
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  // Whatever is left after the last line break.
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty — trailing blank lines are common in exports.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Quote a value for CSV output. */
export function csvEscape(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
