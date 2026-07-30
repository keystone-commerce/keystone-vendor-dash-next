import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";

// Liwip logo for the top-right of the header. Drop the file at
// lib/server/assets/liwip-logo.(png|jpg) and it's embedded automatically; until
// then the header falls back to a text wordmark. Loaded once and cached.
let liwipCache: { kind: "png" | "jpg"; bytes: Buffer } | null | undefined;
function liwipLogoBytes(): { kind: "png" | "jpg"; bytes: Buffer } | null {
  if (liwipCache !== undefined) return liwipCache;
  const dir = path.join(process.cwd(), "lib/server/assets");
  const candidates: [string, "png" | "jpg"][] = [
    ["liwip-logo.png", "png"],
    ["liwip-logo.jpg", "jpg"],
    ["liwip-logo.jpeg", "jpg"],
  ];
  for (const [file, kind] of candidates) {
    try {
      liwipCache = { kind, bytes: fs.readFileSync(path.join(dir, file)) };
      return liwipCache;
    } catch {
      /* try next */
    }
  }
  liwipCache = null;
  return liwipCache;
}

export interface PoPdfLine {
  name: string;
  quantity: number;
  rate: number;
  hsn?: string;
  itemCode?: string;
  brand?: string;
  uom?: string;
  gstPercent?: number;
}

export type PoPdfStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface PoPdfInput {
  vendorName: string;
  poNumber?: string | null;
  createdAt?: Date;
  vendorCode?: string | null;
  /** Drives the status line. Defaults to PENDING (pre-approval document). */
  status?: PoPdfStatus;
  lineItems: PoPdfLine[];
  /** Supplier details for the "Supplier Details" block (all optional). */
  supplier?: {
    address?: string | null;
    gstin?: string | null;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
}

// Helvetica is WinAnsi-encoded and can't render ₹ or smart quotes — normalise to
// ASCII so drawText never throws on real-world data.
const ascii = (s: string) =>
  (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs.")
    .replace(/[^\x20-\x7e]/g, "");

const money = (n: number) =>
  "Rs. " +
  (n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Keystone's own fixed details (from the official template).
const BILL_TO = [
  "Keystone Commerce Private Limited",
  "5th Floor, Tower A, Dr Rajkumar Road",
  "Bengaluru, Karnataka-560103",
  "GSTIN: 29AAMCK2232K1Z9",
  "PAN: AAMCK2232K",
];
const SHIP_TO = [
  "Keystone Commerce Private Limited",
  "Liwip Warehouse, Chunchaghatta Main Road,",
  "Ganapathipura, Konanakunte, Bengaluru,",
  "Karnataka 560062",
  "Contact:",
  "Receiving Hours: 10 AM to 6 PM",
];

const TERMS: [string, string][] = [
  ["Purchase Order Acceptance", "The Seller shall acknowledge acceptance within two (2) working days. Failure to reject the PO in writing shall be deemed acceptance."],
  ["Price", "Prices remain firm and inclusive of all agreed costs unless otherwise specified. No additional charges without prior written approval."],
  ["Quality & Specifications", "Goods shall conform to approved specifications, samples, drawings, artwork and quality standards. Non-conforming goods may be rejected."],
  ["Delivery", "Delivery shall be made strictly as per the PO schedule. Delays shall be immediately notified."],
  ["Packing & Labelling", "Goods shall be securely packed and labeled with PO No., description, quantity, batch/lot, barcode, MRP, manufacturing/expiry dates where applicable."],
  ["Documents Required", "Provide Tax Invoice, Delivery Challan, E-Way Bill, Packing List, Warranty/User Manual, Test Certificates and statutory documents wherever applicable."],
  ["Inspection & Rejection", "Buyer may inspect before or after delivery. Defective, damaged, counterfeit or short-supplied goods may be rejected and replaced at Seller's cost."],
  ["Warranty", "Products shall be genuine, new, defect-free and fit for intended purposes. Warranty obligations survive payment."],
  ["Returns & Replacement", "Rejected goods shall be collected and replaced by the Seller without additional cost."],
  ["Compliance", "Seller shall comply with GST, Legal Metrology, BIS, WPC, EPR and all applicable laws."],
  ["Intellectual Property", "Seller warrants no IP infringement and shall indemnify Keystone against related claims."],
  ["Confidentiality", "Commercial, pricing and customer information shared by Keystone shall remain confidential."],
  ["Non-Circumvention", "Seller shall not directly approach Keystone customers introduced through Keystone."],
  ["Payment Terms", "Payment is subject to receipt, acceptance, valid GST invoice and agreed payment terms."],
  ["Taxes", "Seller shall ensure GST compliance to enable ITC. Losses due to non-compliance are recoverable."],
  ["Indemnity", "Seller indemnifies Keystone against losses from defects, statutory violations and breach."],
  ["Force Majeure", "Neither party shall be liable for events beyond reasonable control; prompt notice required."],
  ["Termination", "Keystone may cancel the PO for breach, delays, insolvency or legal violations."],
  ["Governing Law", "Governed by the laws of India. Bengaluru, Karnataka courts shall have exclusive jurisdiction."],
  ["General", "These terms form the complete agreement. Keystone may revise future standard terms."],
];

/**
 * Build a Purchase Order PDF in Keystone's official layout (header grid, supplier
 * block, billing/delivery block, material table, commercial summary, and the full
 * standard terms). Pure pdf-lib — no fonts on disk, so it runs on serverless.
 *
 * Fields the app doesn't capture yet (Item Code, Brand, UOM, GST %, delivery date,
 * vendor code…) render blank, exactly like the printed template.
 */
export async function buildPoPdf(input: PoPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);

  const orange = rgb(0.85, 0.42, 0.15);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  const grid = rgb(0.72, 0.72, 0.72);
  const bandFill = rgb(0.96, 0.9, 0.83);
  const green = rgb(0.02, 0.59, 0.41); // approved
  const red = rgb(0.86, 0.15, 0.15); // rejected

  const W = 595,
    H = 842,
    M = 36;
  const RIGHT = W - M;

  let page = doc.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const ensure = (needed: number) => {
    if (y - needed < M) newPage();
  };

  const draw = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {},
  ) => page.drawText(ascii(s), { x, y: yy, size: o.size ?? 9, font: o.font ?? font, color: o.color ?? ink });

  const drawR = (s: string, rightX: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = o.size ?? 9;
    const f = o.font ?? font;
    draw(s, rightX - f.widthOfTextAtSize(ascii(s), size), yy, o);
  };

  const drawC = (s: string, cx: number, yy: number, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    const size = o.size ?? 9;
    const f = o.font ?? font;
    draw(s, cx - f.widthOfTextAtSize(ascii(s), size) / 2, yy, o);
  };

  const rect = (x: number, yy: number, w: number, h: number) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: grid, borderWidth: 0.7 });

  /**
   * Truncate to a MEASURED width (character counts are unreliable — 34 "W"s are far
   * wider than 34 "i"s), appending an ellipsis so it's clearly cut off.
   */
  const fit = (s: string, maxW: number, size = 7.5, f: PDFFont = font): string => {
    const str = ascii(s ?? "");
    if (!str || f.widthOfTextAtSize(str, size) <= maxW) return str;
    const dots = "...";
    const dotsW = f.widthOfTextAtSize(dots, size);
    let out = str;
    while (out.length > 1 && f.widthOfTextAtSize(out, size) + dotsW > maxW) {
      out = out.slice(0, -1);
    }
    return out + dots;
  };

  /**
   * Right-aligned numeric cell. Never truncates — a clipped amount would be wrong,
   * not just ugly — so it shrinks the font a little to make a long figure fit.
   */
  const drawRNum = (s: string, rightX: number, yy: number, maxW: number, size = 7.5) => {
    let sz = size;
    while (sz > 5 && font.widthOfTextAtSize(ascii(s), sz) > maxW) sz -= 0.25;
    drawR(s, rightX, yy, { size: sz });
  };

  const wrap = (s: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = ascii(s).split(/\s+/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // ---- Header, matching the official letterhead ----
  // All three marks (orange corner, centre wordmark, Liwip logo) share one bottom
  // baseline so their lower edges line up horizontally.
  const headerTop = y;
  const baseline = headerTop - 44; // common bottom edge for all three marks (raised a little)

  // (1) Orange angled "banner" corner, top-left — vector, no asset. Trimmed smaller
  // (narrower + shorter). SVG space is y-down with the origin at the page's top-left
  // corner, so its bottom edge lands exactly on `baseline`.
  const cornerH = H - baseline;
  page.drawSvgPath(`M 0 0 L 100 0 L 100 ${cornerH - 34} L 46 ${cornerH} L 0 ${cornerH} Z`, {
    x: 0,
    y: H,
    color: orange,
    borderWidth: 0,
  });

  // (2) KEYSTONE COMMERCE wordmark, centred. Raised a little above the shared
  // baseline (its own bottom sits `wordmarkLift` px higher than the corner/logo).
  const rust = rgb(0.63, 0.31, 0.13);
  const wordmarkLift = 12;
  drawC("KEYSTONE", W / 2, baseline + 12 + wordmarkLift, { size: 24, font: serif, color: rust });
  const commerce = "C O M M E R C E";
  draw(
    commerce,
    W / 2 + serif.widthOfTextAtSize("KEYSTONE", 24) / 2 - font.widthOfTextAtSize(commerce, 7),
    baseline + wordmarkLift,
    { size: 7, font: bold, color: rust },
  );

  // (3) Liwip logo, top-right — bottom edge on `baseline`.
  const liwip = liwipLogoBytes();
  if (liwip) {
    try {
      const img =
        liwip.kind === "png" ? await doc.embedPng(liwip.bytes) : await doc.embedJpg(liwip.bytes);
      const lh = 58;
      const lw = (img.width / img.height) * lh;
      page.drawImage(img, { x: RIGHT - lw, y: baseline, width: lw, height: lh });
    } catch {
      drawLiwipPlaceholder();
    }
  } else {
    drawLiwipPlaceholder();
  }
  function drawLiwipPlaceholder() {
    drawR("Liwip", RIGHT, baseline + 10, { size: 18, font: bold, color: orange });
    drawR("Live With Pride.", RIGHT, baseline, { size: 6, font, color: muted });
  }

  y = baseline - 16;
  drawC("KEYSTONE COMMERCE PRIVATE LIMITED", W / 2, y, { size: 11, font: bold });
  y -= 14;
  drawC("PURCHASE ORDER", W / 2, y, { size: 11, font: bold });
  y -= 18;

  // ---- Header info grid (4 columns: label | value | label | value) ----
  const colX = [M, M + 92, M + 261, M + 353, RIGHT]; // 92 | 169 | 92 | 170
  const rowH = 16;
  const created = input.createdAt ?? new Date();
  const headerRows: [string, string, string, string][] = [
    ["PO No.", input.poNumber || "(assigned on approval)", "PO Date", created.toLocaleDateString("en-IN")],
    ["Revision No.", "", "Delivery Date", ""],
    ["Buyer", "Keystone Commerce Private Limited", "Payment Terms", "30 Days"],
    ["Currency", "INR", "Transport", ""],
    ["Incoterms", "-NA-", "Place of Supply", "Karnataka"],
    ["Project/Cost Centre", "", "Vendor Code", input.vendorCode || ""],
  ];
  for (const [l1, v1, l2, v2] of headerRows) {
    const top = y;
    for (let c = 0; c < 4; c++) rect(colX[c], top - rowH, colX[c + 1] - colX[c], rowH);
    const ty = top - rowH + 5;
    draw(l1, colX[0] + 3, ty, { size: 7.5, font: bold, color: muted });
    // Values are clipped to their cell so a long PO number / vendor code can't
    // bleed into the next column or off the page.
    draw(fit(v1, colX[2] - colX[1] - 6, 8), colX[1] + 3, ty, { size: 8 });
    draw(l2, colX[2] + 3, ty, { size: 7.5, font: bold, color: muted });
    draw(fit(v2, colX[4] - colX[3] - 6, 8), colX[3] + 3, ty, { size: 8 });
    y -= rowH;
  }
  y -= 10;

  // ---- Section header helper ----
  const sectionHeader = (label: string) => {
    page.drawRectangle({ x: M, y: y - 14, width: RIGHT - M, height: 14, color: bandFill });
    draw(label, M + 4, y - 10, { size: 8.5, font: bold });
    y -= 14;
  };

  // ---- Supplier Details ----
  sectionHeader("Supplier Details");
  const sup = input.supplier ?? {};
  const supplierRows: [string, string][] = [
    ["Supplier Name", input.vendorName],
    ["Full Address", sup.address || ""],
    ["GSTIN / PAN", sup.gstin || ""],
    ["Contact Person", sup.contactName || ""],
    ["Email / Mobile", [sup.email, sup.phone].filter(Boolean).join(" / ")],
  ];
  const supLabelW = 110;
  for (const [l, v] of supplierRows) {
    const top = y;
    rect(M, top - rowH, supLabelW, rowH);
    rect(M + supLabelW, top - rowH, RIGHT - M - supLabelW, rowH);
    const ty = top - rowH + 5;
    draw(l, M + 3, ty, { size: 7.5, font: bold, color: muted });
    // Clip to the value cell — a long address would otherwise run off the page.
    draw(fit(v, RIGHT - M - supLabelW - 6, 8), M + supLabelW + 3, ty, { size: 8 });
    y -= rowH;
  }
  y -= 10;

  // ---- Billing & Delivery Address (two fixed blocks side by side) ----
  sectionHeader("Billing & Delivery Address");
  const halfW = (RIGHT - M) / 2;
  const blockLines = Math.max(BILL_TO.length, SHIP_TO.length);
  const blockH = 14 + blockLines * 10 + 6;
  rect(M, y - blockH, halfW, blockH);
  rect(M + halfW, y - blockH, halfW, blockH);
  draw("Billing Address", M + 4, y - 10, { size: 7.5, font: bold, color: muted });
  draw("Delivery Address", M + halfW + 4, y - 10, { size: 7.5, font: bold, color: muted });
  let by = y - 22;
  for (const l of BILL_TO) {
    draw(l, M + 4, by, { size: 7.5 });
    by -= 10;
  }
  by = y - 22;
  for (const l of SHIP_TO) {
    draw(l, M + halfW + 4, by, { size: 7.5 });
    by -= 10;
  }
  y -= blockH + 10;

  // ---- Material Details ----
  sectionHeader("Material Details");
  // columns: Sl | Item Code | Product Description | Brand | HSN | Qty | UOM | Rate | GST % | Amount
  const cw = [22, 48, 150, 50, 42, 32, 32, 55, 36, 56];
  const cxs: number[] = [M];
  cw.forEach((w) => cxs.push(cxs[cxs.length - 1] + w));
  const heads = ["Sl", "Item Code", "Product Description", "Brand", "HSN", "Qty", "UOM", "Rate", "GST %", "Amount"];
  const rightCols = new Set([5, 7, 8, 9]); // Qty, Rate, GST%, Amount right-aligned

  const drawTableHead = () => {
    page.drawRectangle({ x: M, y: y - rowH, width: RIGHT - M, height: rowH, color: bandFill });
    for (let c = 0; c < cw.length; c++) rect(cxs[c], y - rowH, cw[c], rowH);
    const ty = y - rowH + 5;
    heads.forEach((h, c) => {
      if (rightCols.has(c)) drawR(h, cxs[c + 1] - 3, ty, { size: 7, font: bold });
      else draw(h, cxs[c] + 3, ty, { size: 7, font: bold });
    });
    y -= rowH;
  };
  drawTableHead();

  let total = 0;
  let taxTotal = 0;
  // One row per line item — the table grows/shrinks with the order and everything
  // below it (Commercial Summary, terms, signatures) flows up or down accordingly.
  // Guard at 1 so an empty PO still renders a valid table body.
  const renderCount = Math.max(input.lineItems.length, 1);
  for (let i = 0; i < renderCount; i++) {
    ensure(rowH + 4);
    if (y === H - M) drawTableHead(); // header repeated after a page break
    const li = input.lineItems[i];
    const top = y;
    for (let c = 0; c < cw.length; c++) rect(cxs[c], top - rowH, cw[c], rowH);
    const ty = top - rowH + 5;
    if (li) {
      const amt = (li.rate || 0) * (li.quantity || 0);
      total += amt;
      taxTotal += amt * ((li.gstPercent || 0) / 100);
      // Every cell is clipped to its own column width (cw[c] minus 3pt padding each
      // side) so long values can never bleed over a border into the next column.
      const pad = 6;
      draw(String(i + 1), cxs[0] + 3, ty, { size: 7.5 });
      draw(fit(li.itemCode || "", cw[1] - pad), cxs[1] + 3, ty, { size: 7.5 });
      draw(fit(li.name, cw[2] - pad), cxs[2] + 3, ty, { size: 7.5 });
      draw(fit(li.brand || "", cw[3] - pad), cxs[3] + 3, ty, { size: 7.5 });
      draw(fit(li.hsn || "", cw[4] - pad), cxs[4] + 3, ty, { size: 7.5 });
      drawRNum(String(li.quantity), cxs[6] - 3, ty, cw[5] - pad);
      draw(fit(li.uom || "EA", cw[6] - pad), cxs[6] + 3, ty, { size: 7.5, color: muted });
      drawRNum(money(li.rate), cxs[8] - 3, ty, cw[7] - pad);
      drawR(li.gstPercent != null ? `${li.gstPercent}%` : "", cxs[9] - 3, ty, { size: 7.5 });
      drawRNum(money(amt), cxs[10] - 3, ty, cw[9] - pad);
    } else {
      draw(String(i + 1), cxs[0] + 3, ty, { size: 7.5, color: muted });
      draw("EA", cxs[6] + 3, ty, { size: 7.5, color: muted });
    }
    y -= rowH;
  }
  y -= 8;

  // The per-row ensure() above only reserves one row at a time, so certain item
  // counts leave `y` near the bottom margin and the summary would spill off the
  // printable area. Reserve the whole block up front: section header + up to four
  // summary rows (Subtotal, CGST, SGST/IGST, Grand Total) + the tax note and status.
  ensure(14 + 4 * rowH + 40);

  // ---- Commercial Summary ----
  sectionHeader("Commercial Summary");

  // GST type is decided by the supplier's state (GSTIN first two digits) vs the
  // Place of Supply, Karnataka (29). Same state -> CGST + SGST; otherwise -> IGST.
  const stateCode = (input.supplier?.gstin || "").slice(0, 2);
  const knownState = /^\d{2}$/.test(stateCode);
  const intraState = knownState && stateCode === "29";
  const grand = total + taxTotal;

  const sumRows: [string, number, boolean][] = [["Subtotal", total, false]];
  if (taxTotal > 0) {
    if (!knownState) sumRows.push(["GST", taxTotal, false]);
    else if (intraState) sumRows.push(["CGST", taxTotal / 2, false], ["SGST", taxTotal / 2, false]);
    else sumRows.push(["IGST", taxTotal, false]);
  }
  sumRows.push(["Grand Total", grand, true]);

  const sumW = 250;
  const labelCellW = sumW - 100;
  const sx = RIGHT - sumW;
  for (const [label, val, strong] of sumRows) {
    rect(sx, y - rowH, labelCellW, rowH);
    rect(sx + labelCellW, y - rowH, sumW - labelCellW, rowH);
    draw(label, sx + 4, y - rowH + 5, { size: 8, font: strong ? bold : font });
    drawR(money(val), RIGHT - 4, y - rowH + 5, {
      size: strong ? 9 : 8,
      font: strong ? bold : font,
      color: strong ? orange : ink,
    });
    y -= rowH;
  }
  // Note the tax treatment so it's unambiguous on the printed PO.
  if (taxTotal > 0) {
    const note = !knownState
      ? "GST as applicable (supplier GSTIN not on file)."
      : intraState
        ? "Intra-state supply (Karnataka): CGST + SGST."
        : "Inter-state supply: IGST.";
    draw(note, M, y - 2, { size: 7, color: muted });
  }
  y -= 14;

  // Status line — same document before and after approval, only this changes.
  const status = input.status ?? "PENDING";
  const statusLabel =
    status === "APPROVED"
      ? "APPROVED"
      : status === "REJECTED"
        ? "REJECTED"
        : "PENDING APPROVAL";
  const statusColor =
    status === "APPROVED" ? green : status === "REJECTED" ? red : orange;
  draw(`Status: ${statusLabel}`, M, y, { size: 8, color: statusColor, font: bold });
  y -= 16;

  // ---- Standard Terms & Conditions ----
  ensure(60);
  draw("STANDARD TERMS & CONDITIONS", M, y, { size: 9, font: bold });
  y -= 12;
  const intro =
    "These Terms & Conditions form an integral part of every Purchase Order ('PO') issued by Keystone Commerce Private Limited ('Buyer'). Acceptance of the Purchase Order or commencement of supply constitutes unconditional acceptance by the Supplier ('Seller').";
  for (const l of wrap(intro, font, 7, RIGHT - M)) {
    ensure(10);
    draw(l, M, y, { size: 7, color: muted });
    y -= 9;
  }
  y -= 4;
  TERMS.forEach(([title, body], i) => {
    const full = `${i + 1}. ${title}: ${body}`;
    const lines = wrap(full, font, 7, RIGHT - M);
    ensure(lines.length * 9 + 2);
    lines.forEach((l, idx) => {
      // bold-ish first line by drawing the "N. Title:" prefix in bold
      if (idx === 0) {
        const prefix = `${i + 1}. ${title}: `;
        draw(prefix, M, y, { size: 7, font: bold });
        const rest = l.slice(prefix.length);
        draw(rest, M + bold.widthOfTextAtSize(prefix, 7), y, { size: 7 });
      } else {
        draw(l, M, y, { size: 7 });
      }
      y -= 9;
    });
    y -= 1;
  });

  // ---- Signatures ----
  ensure(50);
  y -= 16;
  draw("For Keystone Commerce Private Limited", M, y, { size: 8, font: bold });
  draw("Seller Acceptance:", M + halfW, y, { size: 8, font: bold });
  y -= 24;
  draw("Authorized Signatory", M, y, { size: 7.5, color: muted });
  draw("Authorized Signatory | Company Seal | Date", M + halfW, y, { size: 7.5, color: muted });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}
