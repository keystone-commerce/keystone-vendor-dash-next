import type {
  CatalogueDto,
  BillDto,
  PaginatedResult,
  UserDto,
  VendorDto,
  VendorStage,
  VendorStatus,
  VendorCategory,
  BillStatus,
  ZohoStatusDto,
  ZohoSyncResultDto,
  ZohoUnmatchedBillDto,
  PurchaseOrderDto,
  PurchaseOrderStatus,
} from "@shared";
import { api } from "./api-client";

// ── auth ──────────────────────────────────────────────────────────────────────
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserDto;
}
export const authApi = {
  login: (email: string, password: string) =>
    api.post<LoginResponse>("/auth/login", { email, password }).then((r) => r.data),
  requestOtp: (email: string) =>
    api.post<{ sent: boolean }>("/auth/otp/request", { email }).then((r) => r.data),
  verifyOtp: (email: string, code: string) =>
    api.post<LoginResponse>("/auth/otp/verify", { email, code }).then((r) => r.data),
  me: () => api.get<UserDto>("/auth/me").then((r) => r.data),
  logout: (refreshToken: string) => api.post("/auth/logout", { refreshToken }),
};

// ── team / users (admin only) ───────────────────────────────────────────────────
export const usersApi = {
  list: () => api.get<UserDto[]>("/users").then((r) => r.data),
  create: (input: { email: string; name?: string; role: UserDto["role"] }) =>
    api.post<UserDto>("/users", input).then((r) => r.data),
  remove: (id: string) => api.delete(`/users/${id}`).then((r) => r.data),
};

// ── vendors ───────────────────────────────────────────────────────────────────
export interface VendorQuery {
  search?: string;
  category?: VendorCategory | "";
  stage?: VendorStage | "";
  status?: VendorStatus | "";
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}
export interface CreateVendorInput {
  name: string;
  category: VendorCategory;
  status?: VendorStatus;
  contactName?: string | null;
  phone?: string;
  email?: string;
  contractValue?: number; // paise
  rating?: number;
  contractStart?: string;
  contractEnd?: string;
  notes?: string;
  gstin?: string | null; // null explicitly clears it on edit
  gstAddress?: string | null;
}
export type UpdateVendorInput = Partial<CreateVendorInput>;

export const vendorsApi = {
  list: (q: VendorQuery = {}) =>
    api
      .get<PaginatedResult<VendorDto>>("/vendors", {
        params: Object.fromEntries(
          Object.entries(q).filter(([, v]) => v !== undefined && v !== ""),
        ),
      })
      .then((r) => r.data),
  get: (id: string) => api.get<VendorDto>(`/vendors/${id}`).then((r) => r.data),
  create: (input: CreateVendorInput) => api.post<VendorDto>("/vendors", input).then((r) => r.data),
  update: (id: string, input: UpdateVendorInput) =>
    api.patch<VendorDto>(`/vendors/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/vendors/${id}`),
  transition: (id: string, body: { direction?: "advance" | "back"; targetStage?: VendorStage }) =>
    api.post<VendorDto>(`/vendors/${id}/stage`, body).then((r) => r.data),
  setZohoLink: (id: string, zohoVendorId: string | null) =>
    api.patch<VendorDto>(`/vendors/${id}/zoho-link`, { zohoVendorId }).then((r) => r.data),
  exportCsv: () => api.get<string>("/vendors/export.csv", { responseType: "text" }).then((r) => r.data),
  /** Bulk create from CSV. Admin only — the server returns 403 otherwise. */
  importCsv: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<VendorImportResult>("/vendors/import.csv", form)
      .then((r) => r.data);
  },
  importTemplateCsv: () =>
    api.get<string>("/vendors/import-template.csv", { responseType: "text" }).then((r) => r.data),
};

export interface VendorImportResult {
  imported: number;
  skippedExisting: number;
  totalRows: number;
  errors: { row: number; message: string }[];
}

export interface ZohoVendorImportResult {
  imported: number;
  skippedExisting: number;
  linkedExisting: number;
  ambiguous: string[];
  conflicts: string[];
  duplicateZohoNames: string[];
  /** Names imported without contact person / mobile / email — POs are blocked for these. */
  incomplete: string[];
  totalFromZoho: number;
}

export interface ZohoVendorDetailRefreshResult {
  totalLinked: number;
  refreshed: number;
  updated: number;
  incomplete: string[];
  errors: string[];
}

// ── catalogues ────────────────────────────────────────────────────────────────
export interface CatalogueItemInput {
  name: string;
  description?: string;
  unitPrice: number; // paise
  unit?: string;
  hsn?: string;
}
export const cataloguesApi = {
  attach: (
    vendorId: string,
    input: {
      title: string;
      driveFileId?: string;
      viewUrl?: string;
      uploadedAt?: string;
      items?: CatalogueItemInput[];
    },
  ) => api.post<CatalogueDto>(`/vendors/${vendorId}/catalogues`, input).then((r) => r.data),
  /** Upload a catalogue file to Google Drive and attach it. `filename` is an optional rename. */
  upload: (vendorId: string, file: File, opts: { title?: string; filename?: string } = {}) => {
    const fd = new FormData();
    fd.append("file", file);
    if (opts.title) fd.append("title", opts.title);
    if (opts.filename) fd.append("filename", opts.filename);
    return api
      .post<CatalogueDto>(`/vendors/${vendorId}/catalogues/upload`, fd, {
        // Let the browser set multipart/form-data with the correct boundary.
        headers: { "Content-Type": undefined as unknown as string },
      })
      .then((r) => r.data);
  },
  remove: (id: string) => api.delete(`/catalogues/${id}`),
  addItem: (catalogueId: string, input: CatalogueItemInput) =>
    api.post(`/catalogues/${catalogueId}/items`, input).then((r) => r.data),
  removeItem: (itemId: string) => api.delete(`/catalogue-items/${itemId}`),
};

// ── bills ──────────────────────────────────────────────────────────────────
export const billsApi = {
  attach: (
    vendorId: string,
    input: {
      billNumber: string;
      amount: number; // paise
      billDate?: string;
      status?: BillStatus;
      driveFileId?: string;
      viewUrl?: string;
    },
  ) => api.post<BillDto>(`/vendors/${vendorId}/bills`, input).then((r) => r.data),
  update: (
    id: string,
    input: { billNumber?: string; amount?: number; billDate?: string; status?: BillStatus },
  ) => api.patch<BillDto>(`/bills/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/bills/${id}`),
};

// ── drive ─────────────────────────────────────────────────────────────────────
export interface UnassignedFile {
  fileId: string;
  name: string;
  kind: "catalogue" | "bill";
  vendorToken: string;
  webViewLink: string | null;
  modifiedTime: string;
}
export const driveApi = {
  sync: () =>
    api
      .post<{ attached: number; unassigned: number; skipped: number; errors: number }>("/drive/sync")
      .then((r) => r.data),
  unassigned: () => api.get<UnassignedFile[]>("/drive/unassigned").then((r) => r.data),
  assign: (fileId: string, vendorId: string) =>
    api.post(`/drive/unassigned/${fileId}/assign`, { vendorId }),
  ignore: (fileId: string) => api.post(`/drive/unassigned/${fileId}/ignore`),
  status: () =>
    api.get<{ enabled: boolean; folderUrl: string | null }>("/drive/status").then((r) => r.data),
};

// ── zoho ──────────────────────────────────────────────────────────────────────
export const zohoApi = {
  sync: () => api.post<ZohoSyncResultDto>("/zoho/sync").then((r) => r.data),
  status: () => api.get<ZohoStatusDto>("/zoho/status").then((r) => r.data),
  unmatched: () => api.get<ZohoUnmatchedBillDto[]>("/zoho/unmatched").then((r) => r.data),
  assign: (zohoId: string, vendorId: string) =>
    api.post(`/zoho/unmatched/${zohoId}/assign`, { vendorId }),
  /**
   * Open a Zoho bill PDF inline in a new tab. The endpoint is JWT-protected, so we
   * fetch it as an authenticated blob (a plain link would 401) and open an object URL.
   */
  viewBillPdf: async (zohoId: string) => {
    // Open the tab synchronously inside the click gesture — if we open it only after
    // the await below, the browser's popup blocker treats it as non-user-initiated and
    // silently blocks it (nothing opens). We point the placeholder tab at the PDF once
    // the authenticated blob has loaded. (No "noopener" here: it makes window.open
    // return null, and we need the handle to navigate the tab.)
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await api.get(`/zoho/bills/${zohoId}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        // Popup was blocked despite the synchronous open — fall back to same-tab.
        window.location.href = url;
      }
      // Revoke after a minute — long enough for the tab to load the document.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },
  createPurchaseOrder: (input: CreatePurchaseOrderInput) =>
    api.post<CreatePurchaseOrderResult>("/zoho/purchase-orders", input).then((r) => r.data),
  vendors: () =>
    api.get<{ id: string; name: string }[]>("/zoho/vendors").then((r) => r.data),
  /**
   * Bulk-create dashboard vendors from Zoho's vendor contacts, each linked by
   * zohoVendorId so existing bills match on the next sync. Admin only.
   */
  importVendors: (category: string) =>
    api
      .post<ZohoVendorImportResult>("/zoho/vendors/import", { category })
      .then((r) => r.data),
  refreshVendorDetails: () =>
    api
      .post<ZohoVendorDetailRefreshResult>("/zoho/vendors/refresh")
      .then((r) => r.data),
  /** Create a matching Zoho vendor for a dashboard vendor and save its id. */
  createAndLinkVendor: (vendorId: string) =>
    api
      .post<{
        vendorId: string;
        zohoVendorId: string;
        alreadyLinked: boolean;
        matchedExisting?: boolean;
      }>(
        "/zoho/vendors/link",
        { vendorId },
      )
      .then((r) => r.data),
};

export interface PoLineItemInput {
  name: string;
  quantity: number;
  rate: number; // rupees
  hsn?: string;
  gstPercent?: number; // e.g. 18 for 18%
  itemCode?: string;
  brand?: string;
  uom?: string; // unit of measure, e.g. EA, KG, BOX
}
export interface CreatePurchaseOrderInput {
  vendorId: string; // Zoho vendor id
  poNumber?: string;
  date?: string;
  lineItems: PoLineItemInput[];
  emailTo?: string[];
}
export interface CreatePurchaseOrderResult {
  zohoId: string;
  poNumber: string;
  total: number;
  status: string;
  emailed?: boolean;
  emailWarning?: string;
}

// ── purchase orders (approval workflow) ────────────────────────────────────────
export interface CreatePoInput {
  vendorId: string; // dashboard vendor id
  poNumber?: string;
  /** Agreed delivery date as yyyy-mm-dd. Printed on the PO. */
  deliveryDate?: string | null;
  /** Keystone billing address selected for this PO. */
  billingAddress: string;
  lineItems: PoLineItemInput[];
}
export const purchaseOrdersApi = {
  list: (status?: PurchaseOrderStatus) =>
    api
      .get<PurchaseOrderDto[]>("/purchase-orders", { params: status ? { status } : {} })
      .then((r) => r.data),
  create: (input: CreatePoInput) =>
    api.post<PurchaseOrderDto>("/purchase-orders", input).then((r) => r.data),
  /** Edit a PENDING/REJECTED PO. Approved ones are refused server-side (409). */
  update: (
    id: string,
    input: {
      poNumber?: string | null;
      deliveryDate?: string | null;
      billingAddress?: string | null;
      lineItems?: PoLineItemInput[];
    },
  ) =>
    api.patch<PurchaseOrderDto>(`/purchase-orders/${id}`, input).then((r) => r.data),
  approve: (id: string) =>
    api.post<PurchaseOrderDto>(`/purchase-orders/${id}/approve`).then((r) => r.data),
  reject: (id: string, reason: string) =>
    api.post<PurchaseOrderDto>(`/purchase-orders/${id}/reject`, { reason }).then((r) => r.data),
  /**
   * Open a PO's PDF in a new tab. Approved POs return the Zoho PDF; pending ones
   * return a generated PDF. Opens the tab synchronously (before the await) so the
   * browser's popup blocker doesn't kill it.
   */
  viewPdf: async (id: string) => {
    const tab = window.open("about:blank", "_blank");
    try {
      const res = await api.get(`/purchase-orders/${id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      if (tab && !tab.closed) tab.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      throw err;
    }
  },
};

// ── dashboard ─────────────────────────────────────────────────────────────────
export interface DashboardStats {
  totals: {
    totalVendors: number;
    purchaseMade: number;
    totalContractValue: number;
    billdPaid: number;
    paidBillCount: number;
    outstanding: number;
    contractsExpiring: number;
    totalBills: number;
  };
  pipeline: Record<VendorStage, number>;
  contractValueByCategory: { category: VendorCategory; value: number }[];
  billStatus: Record<BillStatus, number>;
  topVendors: { id: string; name: string; contractValue: number }[];
}
export const dashboardApi = {
  stats: () => api.get<DashboardStats>("/dashboard/stats").then((r) => r.data),
};
