import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  InvoiceDto,
  InvoiceStatus,
  VENDOR_CATEGORY_LABELS,
  formatInr,
} from "@shared";
import { cataloguesApi, invoicesApi, vendorsApi, zohoApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import ProgressButton from "@/components/ui/progress-button";
import { formatDate } from "@/lib/format";
import { Modal } from "@/components/Modal";
import { VendorForm } from "./VendorForm";

interface Props {
  vendorId: string;
  onClose: () => void;
}

type Tab = "overview" | "catalogues" | "invoices";

export function VendorDetailModal({ vendorId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const { data: vendor, isLoading } = useQuery({
    queryKey: ["vendors", vendorId],
    queryFn: () => vendorsApi.get(vendorId),
  });

  return (
    <Modal onClose={onClose} title={vendor?.name ?? "Vendor"}>
      {isLoading || !vendor ? (
        <div className="p-8 text-center text-sm text-muted">Loading…</div>
      ) : (
        <>
          <div className="text-xs text-muted mb-3">
            {VENDOR_CATEGORY_LABELS[vendor.category]} · {vendor.status}
          </div>
          <div className="flex gap-2 border-b border-border mb-4">
            {(["overview", "catalogues", "invoices"] as Tab[]).map((t) => (
              <button
                key={t}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
                  tab === t
                    ? "border-orange text-orange-deep"
                    : "border-transparent text-muted hover:text-ink"
                }`}
                onClick={() => setTab(t)}
              >
                {t}{" "}
                {t === "catalogues" && <>({vendor.catalogues?.length ?? 0})</>}
                {t === "invoices" && <>({vendor.invoices?.length ?? 0})</>}
              </button>
            ))}
          </div>
          {tab === "overview" && <VendorForm vendor={vendor} onClose={onClose} />}
          {tab === "catalogues" && (
            <CataloguesTab vendorId={vendor.id} catalogues={vendor.catalogues ?? []} />
          )}
          {tab === "invoices" && (
            <InvoicesTab vendorId={vendor.id} invoices={vendor.invoices ?? []} />
          )}
        </>
      )}
    </Modal>
  );
}

interface CatItemRow {
  name: string;
  price: number; // rupees
  unit: string;
  hsn: string;
}
const emptyItemRow = (): CatItemRow => ({ name: "", price: 0, unit: "", hsn: "" });

function CataloguesTab({
  vendorId,
  catalogues,
}: {
  vendorId: string;
  catalogues: import("@shared").CatalogueDto[];
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<CatItemRow[]>([emptyItemRow()]);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const updateRow = (i: number, patch: Partial<CatItemRow>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const attach = useMutation({
    mutationFn: () => {
      const items = rows
        .filter((r) => r.name.trim())
        .map((r) => ({
          name: r.name.trim(),
          unitPrice: Math.round((Number(r.price) || 0) * 100), // rupees → paise
          unit: r.unit.trim() || undefined,
          hsn: r.hsn.trim() || undefined,
        }));
      return cataloguesApi.attach(vendorId, {
        title,
        items: items.length ? items : undefined,
      });
    },
    onSuccess: () => {
      toast.success("Catalogue added.");
      setTitle("");
      setRows([emptyItemRow()]);
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Attach failed")),
  });

  const upload = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("Choose a file first.");
      const name = renameTo.trim();
      return cataloguesApi.upload(vendorId, uploadFile, {
        title: name || uploadFile.name,
        filename: name || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Catalogue uploaded to Drive & attached.");
      setUploadFile(null);
      setRenameTo("");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Upload failed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => cataloguesApi.remove(id),
    onSuccess: () => {
      toast("Catalogue removed.");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Delete failed")),
  });

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {catalogues.length === 0 && <li className="text-sm text-muted">No catalogues yet.</li>}
        {catalogues.map((c) => (
          <li key={c.id} className="border border-border rounded-keystone p-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{c.title}</div>
                <div className="text-xs text-muted">
                  {formatDate(c.uploadedAt)} · {c.source.replace("_", " ").toLowerCase()} ·{" "}
                  {c.items?.length ?? 0} item(s)
                </div>
              </div>
              {c.viewUrl && (
                <a className="btn py-1" href={c.viewUrl} target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              )}
              <button className="btn-danger py-1" onClick={() => remove.mutate(c.id)}>
                Delete
              </button>
            </div>
            {c.items && c.items.length > 0 && (
              <table className="w-full mt-2 text-xs">
                <thead>
                  <tr className="text-muted text-left">
                    <th className="font-medium py-1">Product</th>
                    <th className="font-medium py-1">Unit</th>
                    <th className="font-medium py-1">HSN</th>
                    <th className="font-medium py-1 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {c.items.map((it) => (
                    <tr key={it.id} className="border-t border-border">
                      <td className="py-1">{it.name}</td>
                      <td className="py-1">{it.unit ?? "—"}</td>
                      <td className="py-1">{it.hsn ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{formatInr(it.unitPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </li>
        ))}
      </ul>

      {/* Upload a catalogue file straight into the vendor's Drive folder */}
      <div className="rounded-keystone border border-border p-3 space-y-2">
        <div className="text-sm font-medium">Upload a catalogue file to Drive</div>
        <p className="text-xs text-muted">
          Pick a PDF, optionally rename it, and it's saved to the Drive folder and attached to this
          vendor automatically.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="block">
            <span className="label">File</span>
            <input
              className="input mt-1 py-1.5 file:mr-2 file:rounded file:border-0 file:bg-orange-light file:px-2 file:py-1 file:text-xs file:text-orange-deep"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="block">
            <span className="label">Rename (optional)</span>
            <input
              className="input mt-1"
              placeholder={uploadFile ? uploadFile.name : "e.g. Acme price list"}
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
            />
          </label>
          {/* showBar: uploads take long enough that a bar reads better than a spinner. */}
          <ProgressButton
            label="Upload to Drive"
            loadingLabel="Uploading…"
            loading={upload.isPending}
            disabled={!uploadFile}
            showBar
            onClick={() => upload.mutate()}
            className="!rounded-keystone h-[38px] text-sm"
          />
        </div>
      </div>

      <form
        className="space-y-3 pt-3 border-t border-border"
        onSubmit={(e) => {
          e.preventDefault();
          attach.mutate();
        }}
      >
        <div className="text-xs text-muted -mb-1">Or add a catalogue manually:</div>
        <label className="block">
          <span className="label">Catalogue title</span>
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="label">Products *</span>
            <button type="button" className="btn py-1 text-xs" onClick={() => setRows((rs) => [...rs, emptyItemRow()])}>
              + Add product
            </button>
          </div>
          <div className="hidden md:grid grid-cols-[1fr_80px_100px_90px_28px] gap-2 text-xs text-muted px-1">
            <span>Product name</span><span>Unit</span><span>Price (₹)</span><span>HSN</span><span />
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_80px_100px_90px_28px] gap-2">
                <input className="input py-1" placeholder="Product name" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                <input className="input py-1" placeholder="pcs" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} />
                <input className="input py-1" type="number" min={0} placeholder="Price" value={r.price} onChange={(e) => updateRow(i, { price: Number(e.target.value) })} />
                <input className="input py-1" placeholder="HSN" value={r.hsn} onChange={(e) => updateRow(i, { hsn: e.target.value })} />
                <button type="button" className="btn-danger py-1 px-2" title="Remove" disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>×</button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-1">
            Add at least one product — a manual catalogue with no products and no file
            would be an empty record. Prices are in ₹.
          </p>
        </div>

        <ProgressButton
          type="submit"
          disabled={!title.trim() || !rows.some((r) => r.name.trim())}
          label="Add catalogue"
          loadingLabel="Adding…"
          loading={attach.isPending}
          className="w-full !rounded-keystone text-sm"
        />
      </form>
    </div>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cls =
    status === "PAID"
      ? "bg-keystone-green/10 text-keystone-green"
      : status === "OVERDUE"
        ? "bg-keystone-red/10 text-keystone-red"
        : "bg-keystone-amber/10 text-keystone-amber";
  return <span className={`chip ${cls} text-[11px] capitalize`}>{status.toLowerCase()}</span>;
}

function InvoicesTab({
  vendorId,
  invoices,
}: {
  vendorId: string;
  invoices: InvoiceDto[];
}) {
  const qc = useQueryClient();
  // "Open in Zoho" is Admin-only: it deep-links into Zoho Books, which non-admins
  // generally can't access (they'd just land on a Zoho login page).
  const isAdmin = useAuthStore((s) => s.user?.role) === "ADMIN";
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [status, setStatus] = useState<InvoiceStatus>("UNPAID");

  const attach = useMutation({
    mutationFn: () =>
      invoicesApi.attach(vendorId, {
        invoiceNumber,
        amount: Math.round(amount * 100),
        status,
      }),
    onSuccess: () => {
      toast.success("Invoice added.");
      setInvoiceNumber("");
      setAmount(0);
      setStatus("UNPAID");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Attach failed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => invoicesApi.remove(id),
    onSuccess: () => {
      toast("Invoice removed.");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Delete failed")),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; amount?: number; status?: InvoiceStatus }) =>
      invoicesApi.update(input.id, {
        amount: input.amount !== undefined ? Math.round(input.amount * 100) : undefined,
        status: input.status,
      }),
    onSuccess: () => {
      toast.success("Invoice updated.");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Update failed")),
  });

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {invoices.length === 0 && <li className="text-sm text-muted">No invoices yet.</li>}
        {invoices.map((inv) => {
          const fromZoho = inv.source === "ZOHO_SYNC";
          return (
            <li key={inv.id} className="flex items-center gap-2 border border-border rounded-keystone p-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {inv.invoiceNumber}
                  {fromZoho && (
                    <span className="chip bg-keystone-blue/10 text-keystone-blue text-[10px]">Zoho</span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {formatDate(inv.invoiceDate)}
                  {inv.dueDate && <> · due {formatDate(inv.dueDate)}</>} ·{" "}
                  {inv.source.replace("_", " ").toLowerCase()}
                </div>
              </div>
              {fromZoho ? (
                <>
                  {/* Zoho-synced fields are read-only — they refresh on the next sync. */}
                  <span className="text-sm font-medium tabular-nums">{formatInr(inv.amount)}</span>
                  <StatusBadge status={inv.status} />
                </>
              ) : (
                <>
                  <input
                    className="input py-1 max-w-[140px]"
                    type="number"
                    defaultValue={inv.amount / 100}
                    onBlur={(e) => {
                      const val = Number(e.target.value);
                      if (val !== inv.amount / 100) patch.mutate({ id: inv.id, amount: val });
                    }}
                  />
                  <select
                    className="input py-1 max-w-[130px]"
                    defaultValue={inv.status}
                    onChange={(e) =>
                      patch.mutate({ id: inv.id, status: e.target.value as InvoiceStatus })
                    }
                  >
                    <option value="PAID">Paid</option>
                    <option value="UNPAID">Unpaid</option>
                    <option value="OVERDUE">Overdue</option>
                  </select>
                </>
              )}
              {inv.zohoId && (
                <button
                  className="btn py-1"
                  title="View the invoice PDF from Zoho"
                  onClick={async () => {
                    try {
                      await zohoApi.viewInvoicePdf(inv.zohoId!);
                    } catch (err) {
                      toast.error(apiError(err, "Could not load the PDF"));
                    }
                  }}
                >
                  View PDF
                </button>
              )}
              {isAdmin && inv.viewUrl && (
                <a
                  className="btn py-1"
                  href={inv.viewUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open this bill in Zoho Books"
                >
                  Open ↗
                </a>
              )}
              {!fromZoho && (
                <button className="btn-danger py-1" onClick={() => remove.mutate(inv.id)}>
                  Delete
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end pt-3 border-t border-border"
        onSubmit={(e) => {
          e.preventDefault();
          attach.mutate();
        }}
      >
        <label className="block md:col-span-2">
          <span className="label">Invoice number</span>
          <input
            className="input mt-1"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            required
          />
        </label>
        <label className="block">
          <span className="label">Amount (₹)</span>
          <input
            className="input mt-1"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select
            className="input mt-1"
            value={status}
            onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
          >
            <option value="PAID">Paid</option>
            <option value="UNPAID">Unpaid</option>
            <option value="OVERDUE">Overdue</option>
          </select>
        </label>
        <ProgressButton
          type="submit"
          label="Add invoice"
          loadingLabel="Adding…"
          loading={attach.isPending}
          className="md:col-span-4 !rounded-keystone h-[38px] text-sm"
        />
      </form>
    </div>
  );
}
