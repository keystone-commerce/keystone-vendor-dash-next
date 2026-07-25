import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { VendorDto } from "@shared";
import { driveApi, UnassignedFile, vendorsApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";

/**
 * Compact Google Drive status chip: a live dot + name, an arrow button that opens the
 * Drive folder, and a popover for any files that still need a vendor.
 */
export function DriveBanner() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: status } = useQuery({
    queryKey: ["drive", "status"],
    queryFn: driveApi.status,
  });
  const { data: unassigned = [] } = useQuery({
    queryKey: ["drive", "unassigned"],
    queryFn: driveApi.unassigned,
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const dotClass = status?.enabled ? "bg-keystone-green" : "bg-keystone-amber";
  const title = !status
    ? "Checking Google Drive…"
    : status.enabled
      ? "Google Drive is connected"
      : "Google Drive is not configured";

  return (
    <div className="relative inline-flex items-center" ref={ref}>
      {/* Split control: the label opens details, the arrow opens the Drive folder. */}
      <button
        className="btn rounded-r-none border-r-0"
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <span className={`block w-2 h-2 shrink-0 self-center rounded-full ${dotClass}`} />
        Drive
        {unassigned.length > 0 && (
          <span className="chip bg-keystone-amber/20 text-keystone-amber ml-1">
            {unassigned.length}
          </span>
        )}
      </button>
      <a
        className="btn rounded-l-none px-2.5 text-orange-deep font-semibold"
        href={status?.folderUrl ?? "#"}
        target="_blank"
        rel="noreferrer"
        title="Open the Vendors Catalog folder in Google Drive"
        aria-label="Open Drive folder"
      >
        ↗
      </a>

      {open && (
        <div className="absolute top-full left-0 z-40 mt-1 w-[min(640px,88vw)] card p-3 shadow-xl space-y-3">
          <div>
            <p className="text-sm font-medium text-rust-dark">{title}</p>
            <p className="text-xs text-muted">
              Catalogues you upload from a vendor’s page are saved to the Vendors Catalog folder
              automatically.
            </p>
          </div>

          {unassigned.length > 0 && (
            <div className="pt-3 border-t border-border space-y-2">
              <p className="text-sm font-medium text-rust-dark">
                {unassigned.length} catalogue file(s) need to be linked to a vendor
              </p>
              <div className="max-h-72 overflow-y-auto space-y-2">
                {unassigned.map((f) => (
                  <UnassignedRow key={f.fileId} file={f} onDone={() => qc.invalidateQueries()} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UnassignedRow({ file, onDone }: { file: UnassignedFile; onDone: () => void }) {
  const [selectedVendor, setSelectedVendor] = useState("");
  const { data: vendors } = useQuery({
    queryKey: ["vendors", "picker"],
    queryFn: () => vendorsApi.list({ pageSize: 200 }),
  });

  const assign = useMutation({
    mutationFn: () => driveApi.assign(file.fileId, selectedVendor),
    onSuccess: () => {
      toast.success(`Assigned "${file.name}"`);
      onDone();
    },
    onError: (err) => toast.error(apiError(err, "Assign failed")),
  });

  const ignore = useMutation({
    mutationFn: () => driveApi.ignore(file.fileId),
    onSuccess: () => {
      toast(`Ignored "${file.name}"`);
      onDone();
    },
    onError: (err) => toast.error(apiError(err, "Ignore failed")),
  });

  return (
    <div className="flex flex-wrap items-center gap-2 bg-orange-light/40 rounded-keystone p-2">
      <span className="text-xs font-medium flex-1 min-w-0 truncate" title={file.name}>
        <span className="chip bg-orange text-white mr-2">{file.kind}</span>
        {file.name}
      </span>
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
      <button className="btn py-1" disabled={ignore.isPending} onClick={() => ignore.mutate()}>
        Ignore
      </button>
    </div>
  );
}
