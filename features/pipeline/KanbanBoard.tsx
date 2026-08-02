import { useMutation, useQueryClient } from "@tanstack/react-query";
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
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="font-semibold">{STAGE_LABELS[stage]}</h3>
        <span className="chip bg-orange-light text-orange-deep">{vendors.length}</span>
      </div>
      <div className="space-y-2">
        {vendors.length === 0 && (
          <div className="text-xs text-muted p-4 text-center border border-dashed border-border rounded-keystone">
            No vendors in this stage.
          </div>
        )}
        {vendors.map((v) => (
          <KanbanCard key={v.id} vendor={v} onOpenVendor={onOpenVendor} />
        ))}
      </div>
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
