export const VendorStage = {
  IN_TALKS: "IN_TALKS",
  CATALOGUE_RECEIVED: "CATALOGUE_RECEIVED",
  PURCHASE_MADE: "PURCHASE_MADE",
} as const;
export type VendorStage = (typeof VendorStage)[keyof typeof VendorStage];

export const VENDOR_STAGE_ORDER: VendorStage[] = [
  VendorStage.IN_TALKS,
  VendorStage.CATALOGUE_RECEIVED,
  VendorStage.PURCHASE_MADE,
];

export const VendorStatus = {
  ACTIVE: "ACTIVE",
  ON_HOLD: "ON_HOLD",
  BLACKLISTED: "BLACKLISTED",
} as const;
export type VendorStatus = (typeof VendorStatus)[keyof typeof VendorStatus];

/**
 * Vendor categories are a code-managed list (the stored value === the display
 * label), so they can be edited here without a database migration. The DB column
 * is a plain string. To add/remove a category, just edit this array.
 */
export const VENDOR_CATEGORIES = [
  "Electronics",
  "Personal Use",
  "Tools",
  "Vehicle Care",
  "Health and Safety",
  "Home and Family",
  "Grooming and Hygiene",
  "Daily Carry",
  "Driver Apparel",
  "Driver Comfort & Climate",
  "Personal Electronics",
  "Home Essentials",
  "Kitchen Appliances",
  "Major Appliances",
  "Cleaning Essentials",
  "Cloths & Brushes",
  "Crockeries",
  "Furniture",
  "Winter Essentials",
  "Vehicle Gadgets",
  "Vehicle Interior",
  "Vehicle Maintenance & Care",
  "Bike Accessories",
  "Bike Maintenance & Care",
  "Bike Comfort",
  "Car Comfort",
  "Small Home Appliances",
  "Home Appliances",
] as const;

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];

/** Kept for existing consumers; value === label, keys preserve list order. */
export const VENDOR_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  VENDOR_CATEGORIES.map((c) => [c, c]),
);

export const BillStatus = {
  PAID: "PAID",
  UNPAID: "UNPAID",
  OVERDUE: "OVERDUE",
} as const;
export type BillStatus = (typeof BillStatus)[keyof typeof BillStatus];

export const DocumentSource = {
  MANUAL_UPLOAD: "MANUAL_UPLOAD",
  DRIVE_SYNC: "DRIVE_SYNC",
  ZOHO_SYNC: "ZOHO_SYNC",
} as const;
export type DocumentSource = (typeof DocumentSource)[keyof typeof DocumentSource];

export const PurchaseOrderStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type PurchaseOrderStatus = (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

/** Which Zoho Books module bills are read from. Bills = money vendors charge Keystone (default). */
export const ZohoBillSource = {
  BILLS: "bills",
  INVOICES: "bills",
} as const;
export type ZohoBillSource = (typeof ZohoBillSource)[keyof typeof ZohoBillSource];

export const UserRole = {
  ADMIN: "ADMIN",
  PROCUREMENT_MEMBER: "PROCUREMENT_MEMBER",
  VIEWER: "VIEWER",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
