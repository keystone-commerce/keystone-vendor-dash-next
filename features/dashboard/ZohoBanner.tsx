import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { VendorDto, ZohoUnmatchedBillDto } from "@shared";
import { vendorsApi, zohoApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import ProgressButton from "@/components/ui/progress-button";
import { formatInr } from "@shared";

/**
 * Compact Zoho Books status chip: a live dot + name, with a popover holding the
 * "Sync bills" action and the unmatched-bill assignment flow. Designed to sit
 * inline in the toolbar rather than as a full-width banner.
 */
export function ZohoBanner() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ["zoho", "status"],
    queryFn: zohoApi.status,
    refetchInterval: 60_000,
  });
  const { data: unmatched = [] } = useQuery({
    queryKey: ["zoho", "unmatched"],
    queryFn: zohoApi.unmatched,
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const sync = useMutation({
    mutationFn: zohoApi.sync,
    onSuccess: (r) => {
      toast.success(
        `Zoho sync complete — ${r.added} added, ${r.updated} updated, ${r.unmatched} unmatched.`,
      );
      qc.invalidateQueries();
      if (r.unmatched > 0) setOpen(true);
    },
    onError: (err) => toast.error(apiError(err, "Sync failed")),
  });

  // Green = connected; amber = needs attention (disabled or unreachable).
  const healthy = status?.connected ?? false;
  const dotClass = healthy ? "bg-keystone-green" : "bg-keystone-amber";
  const title = !status
    ? "Checking connection to Zoho Books…"
    : status.enabled
      ? healthy
        ? "Zoho Books is connected"
        : "Zoho Books needs attention"
      : "Zoho Books — demo mode (no live account connected)";

  return (
    <div className="relative" ref={ref}>
      <button
        className="btn shrink-0 whitespace-nowrap px-3 py-1.5 text-sm"
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <span className={`block w-2 h-2 shrink-0 self-center rounded-full ${dotClass}`} />
        Zoho Books
        {unmatched.length > 0 && (
          <span className="chip bg-keystone-amber/20 text-keystone-amber ml-1">
            {unmatched.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-[min(640px,88vw)] card p-3 shadow-xl space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-rust-dark">{title}</p>
              <p className="text-xs text-muted">
                {status?.lastSyncAt
                  ? `Last synced ${new Date(status.lastSyncAt).toLocaleString("en-IN")}.`
                  : "Bills sync automatically from Zoho Books."}
              </p>
            </div>
            <ProgressButton
              label="Sync now"
              loadingLabel="Syncing…"
              loading={sync.isPending}
              onClick={() => sync.mutate()}
              className="whitespace-nowrap !rounded-keystone text-sm"
            />
          </div>

          {unmatched.length > 0 && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-sm font-medium text-rust-dark">
                {unmatched.length} bill(s) need to be linked to a vendor
              </p>
              <div className="max-h-72 overflow-y-auto space-y-2">
                {unmatched.map((inv) => (
                  <UnmatchedRow key={inv.zohoId} inv={inv} onDone={() => qc.invalidateQueries()} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UnmatchedRow({
  inv,
  onDone,
}: {
  inv: ZohoUnmatchedBillDto;
  onDone: () => void;
}) {
  const [selectedVendor, setSelectedVendor] = useState("");
  const { data: vendors } = useQuery({
    queryKey: ["vendors", "picker"],
    queryFn: () => vendorsApi.list({ pageSize: 200 }),
  });

  const assign = useMutation({
    mutationFn: () => zohoApi.assign(inv.zohoId, selectedVendor),
    onSuccess: () => {
      toast.success(`Linked "${inv.billNumber}" (${inv.vendorName})`);
      onDone();
    },
    onError: (err) => toast.error(apiError(err, "Assign failed")),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 bg-orange-light/40 rounded-keystone p-2">
      <span className="text-xs font-medium flex-1 min-w-0 truncate" title={inv.vendorName}>
        <span className="chip bg-orange text-white mr-2">{inv.billNumber}</span>
        {inv.vendorName} · {formatInr(inv.amount)} · {inv.status}
      </span>
      {inv.viewUrl && (
        <a className="btn py-1" href={inv.viewUrl} target="_blank" rel="noreferrer">
          Open ↗
        </a>
      )}
      <select
        className="input max-w-[200px] py-1"
        value={selectedVendor}
        onChange={(e) => setSelectedVendor(e.target.value)}
      >
        <option value="">Assign to vendor…</option>
        {vendors?.items.map((v: VendorDto) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <button
        className="btn py-1"
        disabled={!selectedVendor || assign.isPending}
        onClick={() => assign.mutate()}
      >
        Assign
      </button>
    </div>
  );
}
