import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PurchaseOrderDto, PurchaseOrderStatus } from "@shared";
import { purchaseOrdersApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { SearchableSelect } from "@/components/SearchableSelect";
import ProgressButton from "@/components/ui/progress-button";

const STATUS_CHIP: Record<PurchaseOrderStatus, string> = {
  PENDING: "bg-keystone-amber/15 text-keystone-amber",
  APPROVED: "bg-keystone-green/10 text-keystone-green",
  REJECTED: "bg-keystone-red/10 text-keystone-red",
};

function inr(n: number) {
  return `₹${(n ?? 0).toLocaleString("en-IN")}`;
}

/** Open a PO's PDF in a new tab (Zoho PDF if approved, generated PDF if pending). */
async function openPoPdf(id: string) {
  try {
    await purchaseOrdersApi.viewPdf(id);
  } catch (err) {
    toast.error(apiError(err, "Could not open the PO PDF"));
  }
}

export function PurchaseOrdersPanel() {
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "ADMIN";
  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | PurchaseOrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const VISIBLE_LIMIT = 5;

  const { data: pos = [] } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: () => purchaseOrdersApi.list(),
  });

  const pendingCount = pos.filter((p) => p.status === "PENDING").length;
  const counts = {
    ALL: pos.length,
    PENDING: pendingCount,
    APPROVED: pos.filter((p) => p.status === "APPROVED").length,
    REJECTED: pos.filter((p) => p.status === "REJECTED").length,
  };

  const q = search.trim().toLowerCase();
  const filtered = pos.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    if (q && !`${p.vendorName ?? ""} ${p.poNumber ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const approve = useMutation({
    mutationFn: (id: string) => purchaseOrdersApi.approve(id),
    onSuccess: (po) => {
      toast.success(`Approved — created in Zoho as ${po.poNumber || po.zohoId}.`);
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Approve failed")),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      purchaseOrdersApi.reject(id, reason),
    onSuccess: () => {
      toast("Purchase order rejected.");
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Reject failed")),
  });

  if (pos.length === 0) return null;

  return (
    <section id="purchase-orders" className="card scroll-mt-4">
      {/* Header with inline filters: title · search · status dropdown */}
      <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">Purchase Orders</h2>
        <div className="flex-1" />
        <input
          className="input w-[200px] py-1.5"
          placeholder="Search vendor or PO #…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShowAll(false);
          }}
        />
        <SearchableSelect
          className="w-[170px]"
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v as "ALL" | PurchaseOrderStatus);
            setShowAll(false);
          }}
          options={[
            { value: "ALL", label: `All (${counts.ALL})` },
            { value: "PENDING", label: `Pending (${counts.PENDING})` },
            { value: "APPROVED", label: `Approved (${counts.APPROVED})` },
            { value: "REJECTED", label: `Rejected (${counts.REJECTED})` },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          No purchase orders match this filter.
        </div>
      ) : (
        <ul
          className={`divide-y divide-border ${
            showAll && filtered.length > VISIBLE_LIMIT ? "max-h-[460px] overflow-y-auto" : ""
          }`}
        >
          {(showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT)).map((po) => (
            <PoRow
              key={po.id}
              po={po}
              isAdmin={isAdmin}
              onView={() => openPoPdf(po.id)}
              onApprove={() => approve.mutate(po.id)}
              onReject={(reason) => reject.mutate({ id: po.id, reason })}
              // Scope "busy" to the row actually being acted on — the mutation state is
              // shared, so without checking `variables` every row would show a spinner.
              busy={
                (approve.isPending && approve.variables === po.id) ||
                (reject.isPending && reject.variables?.id === po.id)
              }
            />
          ))}
        </ul>
      )}
      {filtered.length > VISIBLE_LIMIT && (
        <div className="p-3 border-t border-border text-center">
          <button className="btn py-1" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show less ▲" : `Show all ${filtered.length} orders ▼`}
          </button>
        </div>
      )}
    </section>
  );
}

function PoRow({
  po,
  isAdmin,
  onView,
  onApprove,
  onReject,
  busy,
}: {
  po: PurchaseOrderDto;
  isAdmin: boolean;
  onView: () => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  busy: boolean;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const items = po.lineItems ?? [];
  const needsZohoLink = po.status === "PENDING" && !po.zohoVendorId;

  return (
    <li className="p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{po.vendorName ?? "Vendor"}</span>
            <span className={`chip ${STATUS_CHIP[po.status]}`}>{po.status.toLowerCase()}</span>
            {po.poNumber && <span className="text-xs text-muted">· {po.poNumber}</span>}
          </div>
          <div className="text-xs text-muted mt-0.5">
            {items.length} item(s) · total {inr(po.total)}
            {po.status === "APPROVED" && po.zohoId && <> · in Zoho ✓</>}
          </div>
          <div className="text-xs text-muted mt-1 truncate">
            {items.map((li) => `${li.name}×${li.quantity}`).join(", ")}
          </div>
          {po.status === "REJECTED" && po.decisionReason && (
            <div className="text-xs text-keystone-red mt-1">Rejected: {po.decisionReason}</div>
          )}
          {/* Approval calls Zoho, which needs a linked vendor — say so up front
              instead of letting the admin hit a failed request. */}
          {needsZohoLink && (
            <div className="text-xs text-keystone-amber mt-1">
              ⚠ This vendor isn’t linked to Zoho Books yet — link it (vendor → Edit → “Create in
              Zoho &amp; link”) before this PO can be approved.
            </div>
          )}
        </div>

        {!rejecting && (
          <div className="flex gap-2">
            <button className="btn-primary py-1" onClick={onView}>
              View
            </button>
            {isAdmin && po.status === "PENDING" && (
              <>
                <ProgressButton
                  label="✓ Approve"
                  loadingLabel="Approving…"
                  loading={busy}
                  disabled={needsZohoLink}
                  title={
                    needsZohoLink
                      ? "Link this vendor to Zoho Books before approving"
                      : "Approve and create in Zoho Books"
                  }
                  onClick={onApprove}
                  className="!rounded-keystone px-3 py-1 text-sm"
                />
                <button className="btn-danger py-1" disabled={busy} onClick={() => setRejecting(true)}>
                  ✕ Reject
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {isAdmin && po.status === "PENDING" && rejecting && (
        <div className="mt-2 flex gap-2 flex-wrap">
          <input
            className="input py-1 flex-1 min-w-[200px]"
            placeholder="Reason for rejection"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <button
            className="btn-danger py-1"
            disabled={busy}
            onClick={() => {
              onReject(reason.trim() || "No reason given");
              setRejecting(false);
              setReason("");
            }}
          >
            Confirm reject
          </button>
          <button className="btn py-1" onClick={() => setRejecting(false)}>
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
