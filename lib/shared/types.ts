import {
  DocumentSource,
  BillStatus,
  PurchaseOrderStatus,
  UserRole,
  VendorCategory,
  VendorStage,
  VendorStatus,
} from "./enums";

export interface PurchaseOrderLineDto {
  name: string;
  quantity: number;
  /** Unit price in rupees (Zoho's unit). */
  rate: number;
  hsn?: string;
}

export interface PurchaseOrderDto {
  id: string;
  vendorId: string;
  vendorName?: string;
  zohoVendorId: string | null;
  status: PurchaseOrderStatus;
  lineItems: PurchaseOrderLineDto[];
  /** Total in rupees. */
  total: number;
  poNumber: string | null;
  zohoId: string | null;
  createdById: string | null;
  decidedById: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogueItemDto {
  id: string;
  catalogueId: string;
  name: string;
  description: string | null;
  /** Integer paise. */
  unitPrice: number;
  unit: string | null;
  hsn: string | null;
  createdAt: string;
}

export interface CatalogueDto {
  id: string;
  vendorId: string;
  title: string;
  driveFileId: string | null;
  viewUrl: string | null;
  uploadedAt: string;
  source: DocumentSource;
  createdAt: string;
  items?: CatalogueItemDto[];
}

export interface BillDto {
  id: string;
  vendorId: string;
  billNumber: string;
  amount: number;
  billDate: string;
  dueDate: string | null;
  status: BillStatus;
  driveFileId: string | null;
  zohoId: string | null;
  viewUrl: string | null;
  source: DocumentSource;
  externalId: string | null;
  externalSource: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VendorDto {
  id: string;
  name: string;
  category: VendorCategory;
  stage: VendorStage;
  status: VendorStatus;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  contractValue: number;
  rating: number;
  contractStart: string | null;
  contractEnd: string | null;
  zohoVendorId: string | null;
  notes: string | null;
  gstin: string | null;
  gstAddress: string | null;
  createdAt: string;
  updatedAt: string;
  catalogues?: CatalogueDto[];
  bills?: BillDto[];
  catalogueCount?: number;
  billCount?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStatsDto {
  totalVendors: number;
  totalCategories: number;
  purchaseMadeCount: number;
  purchaseMadePercent: number;
  totalContractValue: number;
  billdPaid: number;
  billdPaidCount: number;
  outstanding: number;
  contractsExpiring: number;
  pipeline: Record<VendorStage, number>;
  contractValueByCategory: Record<string, number>;
  billStatusMix: Record<BillStatus, number>;
  topVendorsByValue: { id: string; name: string; contractValue: number }[];
}

export interface UnassignedFileDto {
  driveFileId: string;
  name: string;
  kind: "Catalogue" | "Bill" | "Unknown";
  parsedVendorToken: string | null;
  createdTime: string;
}

export interface ZohoUnmatchedBillDto {
  zohoId: string;
  billNumber: string;
  vendorName: string;
  zohoVendorId: string | null;
  amount: number;
  status: BillStatus;
  billDate: string;
  dueDate: string | null;
  viewUrl: string | null;
}

export interface ZohoSyncResultDto {
  added: number;
  updated: number;
  unmatched: number;
  skipped: number;
  errors: number;
}

export interface ZohoStatusDto {
  enabled: boolean;
  connected: boolean;
  syncModule: "bills" | "bills";
  dataCenter: string;
  lastSyncAt: string | null;
  lastResult: ZohoSyncResultDto | null;
  unmatchedCount: number;
  message: string | null;
}

export interface AuditLogDto {
  id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
