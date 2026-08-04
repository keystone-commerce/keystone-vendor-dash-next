import { ReactNode, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { VENDOR_CATEGORIES, VendorCategory, VendorStage } from "@shared";
import { vendorsApi, VendorQuery, VendorImportResult } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Modal } from "@/components/Modal";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { ShowMore } from "@/components/ui/show-more";

interface Props {
  query: VendorQuery;
  onQueryChange: (patch: Partial<VendorQuery>) => void;
  onAddVendor: () => void;
  onGeneratePo: () => void;
  /** Integration status chips (Zoho / Drive), rendered next to the Stage filter. */
  statusSlot?: ReactNode;
  /** State setter — the ShowMore control expects a Dispatch, not a plain callback. */
  setStatsOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  statsOpen?: boolean;
}

const STAGE_LABELS: Record<VendorStage, string> = {
  IN_TALKS: "In Talks",
  CATALOGUE_RECEIVED: "Catalogue Received",
  PURCHASE_MADE: "Purchase Made",
};

export function Toolbar({
  query,
  onQueryChange,
  onAddVendor,
  onGeneratePo,
  statusSlot,
  setStatsOpen,
  statsOpen,
}: Props) {
  const qc = useQueryClient();
  // Bulk import is admin-only; the server enforces it too (403), this just hides the
  // control from people who can't use it.
  const isAdmin = useAuthStore((s) => s.user?.role) === "ADMIN";
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState<VendorImportResult | null>(null);

  // Debounce the search box: typing used to fire a DB query on every keystroke.
  const [searchText, setSearchText] = useState(query.search ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((query.search ?? "") !== searchText) onQueryChange({ search: searchText });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  async function onExport() {
    try {
      const csv = await vendorsApi.exportCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(apiError(err, "Export failed"));
    }
  }

  function download(text: string, filename: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File) {
    setImporting(true);
    setReport(null);
    try {
      const res = await vendorsApi.importCsv(file);
      setReport(res);
      if (res.errors.length) {
        // Nothing was written — the server rejects the whole file if any row is bad.
        toast.error(`Nothing imported — ${res.errors.length} row(s) need fixing.`);
      } else if (res.imported) {
        toast.success(
          `Imported ${res.imported} vendor(s)` +
            (res.skippedExisting ? `, skipped ${res.skippedExisting} already present.` : "."),
        );
        qc.invalidateQueries();
      } else {
        toast(`Nothing to import — all ${res.skippedExisting} vendor(s) already exist.`);
      }
    } catch (err) {
      toast.error(apiError(err, "Import failed"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Flexes with the viewport so the row stays on one line on smaller laptops. */}
      <input
        className="input flex-1 min-w-[130px] max-w-[240px]"
        placeholder="Search vendors…"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
      />
      <SearchableSelect
        className="w-[155px]"
        value={query.category ?? ""}
        onChange={(v) => onQueryChange({ category: v as VendorCategory | "" })}
        options={VENDOR_CATEGORIES}
        allowEmpty
        emptyLabel="All Categories"
        placeholder="All Categories"
      />
      <SearchableSelect
        className="w-[140px]"
        value={query.stage ?? ""}
        onChange={(v) => onQueryChange({ stage: v as VendorStage | "" })}
        options={(Object.keys(STAGE_LABELS) as VendorStage[]).map((s) => ({
          value: s,
          label: STAGE_LABELS[s],
        }))}
        allowEmpty
        emptyLabel="All Stages"
        placeholder="All Stages"
      />
      {statusSlot}
      {/* Stats disclosure. The component defaults to a full-width centred bar, so we
          force it back to a compact toolbar-sized control (!w-auto beats its
          w-[calc(100%-40px)]) and match the 38px height / corner radius of its
          neighbours. */}
      {setStatsOpen && (
        <ShowMore
          expanded={!!statsOpen}
          onClick={setStatsOpen}
          label="Stats"
          className="!w-auto min-h-0 shrink-0 [&>div>button]:h-[38px] [&>div>button]:rounded-keystone [&>div>button]:border-border"
        />
      )}
      <div className="flex-1" />
      {/* Labels shorten below xl so the row still fits on smaller laptops. */}
      <button className="btn" onClick={onExport} title="Export vendors as CSV">
        Export<span className="hidden xl:inline">&nbsp;CSV</span>
      </button>
      {/* Animated CTA, sized to line up with the plain .btn neighbours. Two instances
          swapped by breakpoint because the label lives in a prop and can't shrink with
          CSS — keeps the toolbar on one line on smaller laptops. */}
      <InteractiveHoverButton
        text="PO"
        onClick={onGeneratePo}
        title="Generate a purchase order"
        className="h-[38px] w-[72px] shrink-0 rounded-keystone border-border py-0 text-sm xl:hidden"
      />
      <InteractiveHoverButton
        text="Generate PO"
        onClick={onGeneratePo}
        title="Generate a purchase order"
        // The component parks its dot at left-[20%], which collides with a label this
        // long — nudge just the dot leftwards (last child div) without touching the
        // shared component. Hover still expands it from the edge.
        className="hidden h-[38px] w-[150px] shrink-0 rounded-keystone border-border py-0 text-sm xl:block [&>div:last-child]:left-[7%]"
      />
      {/* Sits next to Add Vendor because it's the bulk equivalent of it. Admin only —
          one file can create hundreds of vendors in a single call. */}
      {isAdmin && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              // Reset first so choosing the same file twice still fires onChange.
              e.target.value = "";
              if (f) onImport(f);
            }}
          />
          <button
            className="btn"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            title="Bulk-create vendors from a CSV file"
          >
            {importing ? (
              "Uploading…"
            ) : (
              <>
                Bulk<span className="hidden xl:inline">&nbsp;Upload</span>
              </>
            )}
          </button>
        </>
      )}
      <button className="btn-primary" onClick={onAddVendor} title="Add a vendor">
        +&nbsp;<span className="hidden xl:inline">Add&nbsp;</span>Vendor
      </button>

      {/* Shown only when the file was rejected. The import is all-or-nothing, so this is
          a worklist: fix these rows, re-upload. Row numbers match the spreadsheet, with
          the header counted as row 1. */}
      {report && report.errors.length > 0 && (
        <Modal
          title={`Import rejected — ${report.errors.length} row(s) need fixing`}
          onClose={() => setReport(null)}
          maxWidthClass="max-w-2xl"
        >
          <p className="text-sm text-muted mb-3">
            Nothing was imported. The whole file is checked first, so you can fix these and
            upload again without creating duplicates.
          </p>
          <ul className="divide-y divide-border border border-border rounded-keystone max-h-[50vh] overflow-y-auto">
            {report.errors.map((e, i) => (
              <li key={i} className="flex gap-3 p-2 text-sm">
                <span className="font-mono text-xs text-muted shrink-0 w-16">row {e.row}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 mt-4">
            <button
              className="btn py-1"
              onClick={async () => {
                try {
                  download(await vendorsApi.importTemplateCsv(), "vendor-import-template.csv");
                } catch (err) {
                  toast.error(apiError(err, "Couldn't download the template"));
                }
              }}
            >
              Download template
            </button>
            <button className="btn-primary py-1" onClick={() => setReport(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
