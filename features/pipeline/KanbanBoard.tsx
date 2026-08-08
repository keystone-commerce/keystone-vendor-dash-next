import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  VENDOR_CATEGORY_LABELS,
  VendorDto,
  VendorStage,
} from "@shared";
import { vendorsApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { formatInr } from "@/lib/format";

interface Props {
  vendors: VendorDto[];
  onOpenVendor: (id: string) => void;
}

const STAGE_LABELS: Record<VendorStage, string> = {
  IN_TALKS: "In Talks",
  CATALOGUE_RECEIVED: "Catalogue Received",
  PURCHASE_MADE: "Purchase Made",
};

const STAGES: VendorStage[] = ["IN_TALKS", "CATALOGUE_RECEIVED", "PURCHASE_MADE"];
const INITIAL_VISIBLE_VENDORS = 10;

export function KanbanBoard({ vendors, onOpenVendor }: Props) {
  const grouped: Record<VendorStage, VendorDto[]> = {
    IN_TALKS: [],
    CATALOGUE_RECEIVED: [],
    PURCHASE_MADE: [],
  };
  for (const v of vendors) grouped[v.stage].push(v);

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="text-lg font-bold">Procurement Pipeline</h2>
        <p className="text-xs text-muted">Click a card to open full vendor detail</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {STAGES.map((stage) => (
          <Column
            key={stage}
            stage={stage}
            vendors={grouped[stage]}
            onOpenVendor={onOpenVendor}
          />
        ))}
      </div>
    </section>
  );
}

function Column({
  stage,
  vendors,
  onOpenVendor,
}: {
  stage: VendorStage;
  vendors: VendorDto[];
  onOpenVendor: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const catalogueTotal = vendors.reduce((sum, vendor) => sum + (vendor.catalogueCount ?? 0), 0);
  const billTotal = vendors.reduce((sum, vendor) => sum + (vendor.billCount ?? 0), 0);
  const visibleVendors = showAll ? vendors : vendors.slice(0, INITIAL_VISIBLE_VENDORS);
  const hiddenVendorCount = vendors.length - INITIAL_VISIBLE_VENDORS;

  return (
    <div className="card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 px-1">
        <h3 className="font-semibold">{STAGE_LABELS[stage]}</h3>
        <div className="flex flex-wrap items-center justify-end gap-1">
          <span className="chip bg-orange-light text-orange-deep">
            {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
          </span>
          {stage === "CATALOGUE_RECEIVED" && (
            <span className="chip bg-keystone-blue/10 text-keystone-blue">
              {catalogueTotal} catalogue{catalogueTotal === 1 ? "" : "s"}
            </span>
          )}
          {stage === "PURCHASE_MADE" && (
            <span className="chip bg-keystone-green/10 text-keystone-green">
              {billTotal} bill{billTotal === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {vendors.length === 0 && (
          <div className="text-xs text-muted p-4 text-center border border-dashed border-border rounded-keystone">
            No vendors in this stage.
          </div>
        )}
        {visibleVendors.map((v) => (
          <KanbanCard key={v.id} vendor={v} onOpenVendor={onOpenVendor} />
        ))}
      </div>
      {vendors.length > INITIAL_VISIBLE_VENDORS && (
        <button
          type="button"
          className="btn w-full mt-3 py-2 text-xs"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show less" : `Show more (${hiddenVendorCount})`}
        </button>
      )}
    </div>
  );
}

function KanbanCard({
  vendor,
  onOpenVendor,
}: {
  vendor: VendorDto;
  onOpenVendor: (id: string) => void;
}) {
  const qc = useQueryClient();

  const move = useMutation({
    mutationFn: (direction: "advance" | "back") => vendorsApi.transition(vendor.id, { direction }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vendors"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(apiError(err, "Stage change blocked")),
  });

  const canBack = vendor.stage !== "IN_TALKS";
  const canAdvance = vendor.stage !== "PURCHASE_MADE";

  return (
    <div
      className="bg-orange-light/40 hover:bg-orange-light border border-border rounded-keystone p-3 cursor-pointer transition-colors"
      onClick={() => onOpenVendor(vendor.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{vendor.name}</div>
          <div className="text-xs text-muted">{VENDOR_CATEGORY_LABELS[vendor.category]}</div>
        </div>
        <div className="text-sm font-semibold whitespace-nowrap">
          {formatInr(vendor.contractValue)}
        </div>
      </div>
      <div className="flex gap-3 mt-2 text-xs">
        <span className="text-keystone-blue font-medium">
          {vendor.catalogueCount ?? 0} catalogue(s)
        </span>
        <span className="text-keystone-green font-medium">
          {vendor.billCount ?? 0} bill(s)
        </span>
      </div>
      <div className="flex gap-2 mt-3">
        {canBack && (
          <button
            className="btn flex-1 py-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              move.mutate("back");
            }}
            disabled={move.isPending}
          >
            ← Back
          </button>
        )}
        {canAdvance && (
          <button
            className="btn-primary flex-1 py-1.5 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              move.mutate("advance");
            }}
            disabled={move.isPending}
          >
            Advance →
          </button>
        )}
      </div>
    </div>
  );
}
