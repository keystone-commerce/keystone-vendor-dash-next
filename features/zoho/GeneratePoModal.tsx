import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { VendorDto } from "@shared";
import { Modal } from "@/components/Modal";
import { vendorsApi, purchaseOrdersApi, PoLineItemInput } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import ProgressButton from "@/components/ui/progress-button";
import { formatInr } from "@/lib/format";

interface Props {
  onClose: () => void;
  /** Optional: preselect this dashboard vendor (uses its Zoho vendor id). */
  initialVendorId?: string;
}

interface LineRow {
  itemCode: string;
  name: string;
  brand: string;
  hsn: string;
  quantity: number;
  uom: string;
  rate: number; // rupees
  gstPercent: number; // e.g. 18
}

const emptyRow = (): LineRow => ({
  itemCode: "",
  name: "",
  brand: "",
  hsn: "",
  quantity: 1,
  uom: "EA",
  rate: 0,
  gstPercent: 18,
});

/** Coerce a form value to a safe, non-negative number (NaN/empty/negative -> 0). */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function GeneratePoModal({ onClose, initialVendorId }: Props) {
  const { data: vendorsPage } = useQuery({
    queryKey: ["vendors", "po-picker"],
    queryFn: () => vendorsApi.list({ pageSize: 200 }),
  });
  const vendors = vendorsPage?.items ?? [];

  const [dashboardVendorId, setDashboardVendorId] = useState(initialVendorId ?? "");
  const [zohoVendorId, setZohoVendorId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [rows, setRows] = useState<LineRow[]>([emptyRow()]);

  // Load the picked vendor's full detail (incl. catalogue items) so we can offer a picker.
  const { data: vendorDetail } = useQuery({
    queryKey: ["vendors", dashboardVendorId, "detail"],
    queryFn: () => vendorsApi.get(dashboardVendorId),
    enabled: Boolean(dashboardVendorId),
  });
  const catalogueItems = (vendorDetail?.catalogues ?? []).flatMap((c) =>
    (c.items ?? []).map((it) => ({ ...it, catalogueTitle: c.title })),
  );

  // When a dashboard vendor is picked, prefill its linked Zoho vendor id.
  function onPickVendor(id: string) {
    setDashboardVendorId(id);
    const v = vendors.find((x: VendorDto) => x.id === id);
    if (v?.zohoVendorId) setZohoVendorId(v.zohoVendorId);
  }

  // Add a catalogue item as a PO line (paise → rupees). Replaces a blank first row if present.
  function addCatalogueItem(itemId: string) {
    const it = catalogueItems.find((x) => x.id === itemId);
    if (!it) return;
    const line: LineRow = {
      itemCode: "",
      name: it.name,
      brand: "",
      hsn: it.hsn ?? "",
      quantity: 1,
      uom: "EA",
      rate: Math.round(it.unitPrice) / 100,
      gstPercent: 18,
    };
    setRows((rs) => {
      const onlyBlank = rs.length === 1 && !rs[0].name.trim() && !rs[0].rate;
      return onlyBlank ? [line] : [...rs, line];
    });
  }

  const total = useMemo(
    () => rows.reduce((sum, r) => sum + (Number(r.rate) || 0) * (Number(r.quantity) || 0), 0),
    [rows],
  );
  const gstTotal = useMemo(
    () =>
      rows.reduce(
        (sum, r) =>
          sum + (Number(r.rate) || 0) * (Number(r.quantity) || 0) * ((Number(r.gstPercent) || 0) / 100),
        0,
      ),
    [rows],
  );

  const updateRow = (i: number, patch: Partial<LineRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const create = useMutation({
    mutationFn: () => {
      // Only complete rows (name + positive qty + positive rate) are submitted, and
      // every number is coerced through `num()` so a cleared/partial field can never
      // send NaN (which serializes to null) to the server.
      const lineItems: PoLineItemInput[] = rows
        .filter((r) => r.name.trim() && num(r.quantity) > 0 && num(r.rate) > 0)
        .map((r) => ({
          name: r.name.trim(),
          quantity: num(r.quantity),
          rate: num(r.rate),
          hsn: r.hsn.trim() || undefined,
          gstPercent: num(r.gstPercent),
          itemCode: r.itemCode.trim() || undefined,
          brand: r.brand.trim() || undefined,
          uom: r.uom.trim() || undefined,
        }));
      // Submit for approval — the PO is created in the dashboard as PENDING. It only
      // goes to Zoho + the vendor after an Admin approves it.
      return purchaseOrdersApi.create({
        vendorId: dashboardVendorId,
        poNumber: poNumber.trim() || undefined,
        lineItems,
      });
    },
    onSuccess: () => {
      toast.success("Purchase Order submitted for approval.");
      onClose();
    },
    onError: (err) => toast.error(apiError(err, "Could not submit the Purchase Order")),
  });

  const canSubmit =
    dashboardVendorId.length > 0 &&
    rows.some((r) => r.name.trim() && num(r.quantity) > 0 && num(r.rate) > 0);

  return (
    <Modal title="Submit Purchase Order for approval" onClose={onClose} maxWidthClass="max-w-6xl">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Vendor *</span>
            <select
              className="input mt-1"
              value={dashboardVendorId}
              onChange={(e) => onPickVendor(e.target.value)}
            >
              <option value="">Select vendor…</option>
              {vendors.map((v: VendorDto) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.zohoVendorId ? ` — Zoho ID: ${v.zohoVendorId}` : " (not linked to Zoho)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">PO number (optional)</span>
            <input
              className="input mt-1"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="Auto-generated if blank"
            />
          </label>
        </div>

        {dashboardVendorId && (
          <div className="text-xs">
            {zohoVendorId ? (
              <span className="text-keystone-green">
                ✓ Linked to Zoho — vendor ID <span className="font-mono">{zohoVendorId}</span>.
                Will be created there once approved.
              </span>
            ) : (
              <span className="text-keystone-amber">
                ⚠ This vendor isn't linked to Zoho yet (no vendor ID). You can still submit, but
                an Admin must link it (vendor → "Create in Zoho & link") before approving.
              </span>
            )}
          </div>
        )}

        {catalogueItems.length > 0 && (
          <label className="block">
            <span className="label">Add from {vendorDetail?.name ?? "vendor"}'s catalogue</span>
            <select
              className="input mt-1"
              value=""
              onChange={(e) => {
                if (e.target.value) addCatalogueItem(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Pick a product to add…</option>
              {catalogueItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} — {formatInr(it.unitPrice)}
                  {it.hsn ? ` · HSN ${it.hsn}` : ""} ({it.catalogueTitle})
                </option>
              ))}
            </select>
          </label>
        )}

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="label">Line items</span>
            <button type="button" className="btn py-1 text-xs" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
              + Add item
            </button>
          </div>
          {/* One horizontal row per item — all columns visible at once in the wide modal. */}
          <div className="space-y-1.5">
            {/* header labels (shown once) */}
            <div className="grid grid-cols-[90px_minmax(160px,1fr)_1fr_80px_60px_64px_100px_70px_40px] gap-2 px-1 text-[10px] uppercase tracking-wide text-muted">
              <span>Item Code</span>
              <span>Product Description</span>
              <span>Brand</span>
              <span>HSN</span>
              <span>Qty</span>
              <span>UOM</span>
              <span>Price (₹)</span>
              <span>GST %</span>
              <span />
            </div>
            {rows.map((r, i) => (
              <div
                key={i}
                className="grid grid-cols-[90px_minmax(160px,1fr)_1fr_80px_60px_64px_100px_70px_40px] gap-2 items-center"
              >
                <input className="input py-1" placeholder="Code" value={r.itemCode} onChange={(e) => updateRow(i, { itemCode: e.target.value })} />
                <input className="input py-1" placeholder="Product name" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                <input className="input py-1" placeholder="Brand" value={r.brand} onChange={(e) => updateRow(i, { brand: e.target.value })} />
                <input className="input py-1" placeholder="HSN" value={r.hsn} onChange={(e) => updateRow(i, { hsn: e.target.value })} />
                <input className="input py-1" type="number" min={0} value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} />
                <input className="input py-1" placeholder="EA" value={r.uom} onChange={(e) => updateRow(i, { uom: e.target.value })} />
                <input className="input py-1" type="number" min={0} value={r.rate} onChange={(e) => updateRow(i, { rate: Number(e.target.value) })} />
                <input className="input py-1" type="number" min={0} max={28} value={r.gstPercent} onChange={(e) => updateRow(i, { gstPercent: Number(e.target.value) })} />
                <button
                  type="button"
                  className="btn-danger py-1 px-0"
                  title="Remove item"
                  disabled={rows.length === 1}
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <span className="text-sm font-medium">
            Subtotal <span className="tabular-nums">{formatInr(total * 100)}</span>
            {gstTotal > 0 && (
              <span className="text-muted font-normal">
                {" "}
                + GST <span className="tabular-nums">{formatInr(gstTotal * 100)}</span>
              </span>
            )}
            {"  ·  "}Total{" "}
            <span className="tabular-nums text-orange-deep">{formatInr((total + gstTotal) * 100)}</span>
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            {/* loading is driven by the real mutation, so the spinner tracks the
                actual submit rather than a timer. */}
            <ProgressButton
              type="submit"
              label="Submit for approval"
              loadingLabel="Submitting…"
              loading={create.isPending}
              disabled={!canSubmit}
              className="!rounded-keystone h-[38px] text-sm"
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
