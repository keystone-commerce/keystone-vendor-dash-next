/**
 * GSTIN helpers — pure functions, no API calls.
 *
 * A GSTIN is structured, so a lot can be validated/derived offline for free:
 *   27  AAPFU0939F  1  Z  V
 *   ^^  ^^^^^^^^^^  ^  ^  ^
 *   |   |           |  |  └─ check digit (mod-36 checksum)
 *   |   |           |  └──── always 'Z' (reserved)
 *   |   |           └─────── entity number for that PAN in the state
 *   |   └─────────────────── the holder's 10-char PAN
 *   └─────────────────────── state code
 */

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** State code (first two digits) → state name. */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

/** 4th character of the PAN → kind of entity. */
const PAN_ENTITY_TYPES: Record<string, string> = {
  A: "Association of Persons",
  B: "Body of Individuals",
  C: "Company",
  F: "Firm / LLP",
  G: "Government",
  H: "Hindu Undivided Family",
  J: "Artificial Juridical Person",
  L: "Local Authority",
  P: "Individual / Proprietor",
  T: "Trust",
};

export function normalizeGstin(input: string): string {
  return (input ?? "").toUpperCase().replace(/\s+/g, "");
}

/**
 * Verify the 15th character, which is a mod-36 checksum of the first 14.
 * Catches typos without spending an API call.
 */
export function hasValidGstinChecksum(gstin: string): boolean {
  const value = normalizeGstin(gstin);
  if (value.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = CHARSET.indexOf(value[i]);
    if (code < 0) return false;
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36] === value[14];
}

export interface GstinParts {
  gstin: string;
  stateCode: string;
  state: string | null;
  pan: string;
  entityType: string | null;
}

/** Structural check (shape + state code). Returns null when the GSTIN isn't valid. */
export function parseGstin(input: string): GstinParts | null {
  const gstin = normalizeGstin(input);
  if (!GSTIN_RE.test(gstin)) return null;
  const stateCode = gstin.slice(0, 2);
  if (!GST_STATE_CODES[stateCode]) return null;
  const pan = gstin.slice(2, 12);
  return {
    gstin,
    stateCode,
    state: GST_STATE_CODES[stateCode] ?? null,
    pan,
    entityType: PAN_ENTITY_TYPES[pan[3]] ?? null,
  };
}

/**
 * Hard validation — only things we're certain about (length, shape, state code).
 * Deliberately does NOT include the checksum: a false negative there would block a
 * legitimate vendor, and the GST API validates the number properly anyway.
 */
export function gstinError(input: string): string | null {
  const gstin = normalizeGstin(input);
  if (!gstin) return "GSTIN is required.";
  if (gstin.length !== 15) return "A GSTIN is 15 characters.";
  if (!GSTIN_RE.test(gstin)) return "That doesn't look like a valid GSTIN.";
  if (!GST_STATE_CODES[gstin.slice(0, 2)]) return `Unknown state code "${gstin.slice(0, 2)}".`;
  return null;
}

/** Soft advisory — shown as a hint, never blocks submission. */
export function gstinWarning(input: string): string | null {
  const gstin = normalizeGstin(input);
  if (gstinError(gstin)) return null; // hard error already covers it
  if (!hasValidGstinChecksum(gstin)) return "Check digit looks off — double-check the GSTIN.";
  return null;
}
