import { ReactNode, useState } from "react";
import { toast } from "sonner";
import { VENDOR_CATEGORIES, VendorCategory, VendorStage } from "@shared";
import { vendorsApi, VendorQuery } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { SearchableSelect } from "@/components/SearchableSelect";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { ShowMore } from "@/components/ui/show-more";
import ExpandableSearchBar from "@/components/ui/expandable-search-bar";
import { BulkAddVendorsModal } from "@/features/vendors/BulkAddVendorsModal";

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
  // Bulk add is admin-only; both endpoints enforce it too (403), this just hides the
  // control from people who can't use it.
  const isAdmin = useAuthStore((s) => s.user?.role) === "ADMIN";
  const [bulkOpen, setBulkOpen] = useState(false);

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
    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1">
      {/* Flexes with the viewport so the row stays on one line on smaller laptops. */}
      <ExpandableSearchBar
        width={240}
        placeholder="Search vendors..."
        onSearch={(value) => onQueryChange({ search: value.trim() })}
      />
      <div className="min-w-6 flex-1" />
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
          one action can create every vendor in the Zoho org. */}
      {isAdmin && (
        <button
          className="btn"
          onClick={() => setBulkOpen(true)}
          title="Add many vendors at once — from Zoho, or a CSV file"
        >
          Bulk<span className="hidden xl:inline">&nbsp;Upload</span>
        </button>
      )}
      <button className="btn-primary" onClick={onAddVendor} title="Add a vendor">
        +&nbsp;<span className="hidden xl:inline">Add&nbsp;</span>Vendor
      </button>

      {bulkOpen && <BulkAddVendorsModal onClose={() => setBulkOpen(false)} />}
    </div>
  );
}
