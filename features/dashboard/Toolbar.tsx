import { ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { VENDOR_CATEGORIES, VendorCategory, VendorStage } from "@shared";
import { vendorsApi, VendorQuery } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { SearchableSelect } from "@/components/SearchableSelect";

interface Props {
  query: VendorQuery;
  onQueryChange: (patch: Partial<VendorQuery>) => void;
  onAddVendor: () => void;
  onGeneratePo: () => void;
  /** Integration status chips (Zoho / Drive), rendered next to the Stage filter. */
  statusSlot?: ReactNode;
  onToggleStats?: () => void;
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
  onToggleStats,
  statsOpen,
}: Props) {
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
      {onToggleStats && (
        <button className="btn" onClick={onToggleStats} title="Show dashboard statistics">
          Stats {statsOpen ? "▲" : "▼"}
        </button>
      )}
      <div className="flex-1" />
      {/* Labels shorten below xl so the row still fits on smaller laptops. */}
      <button className="btn" onClick={onExport} title="Export vendors as CSV">
        Export<span className="hidden xl:inline">&nbsp;CSV</span>
      </button>
      <button className="btn" onClick={onGeneratePo} title="Generate a purchase order">
        <span className="hidden xl:inline">Generate&nbsp;</span>PO
      </button>
      <button className="btn-primary" onClick={onAddVendor} title="Add a vendor">
        +&nbsp;<span className="hidden xl:inline">Add&nbsp;</span>Vendor
      </button>
    </div>
  );
}
