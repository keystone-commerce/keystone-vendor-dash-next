import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/features/layout/Header";
import { Footer } from "@/features/layout/Footer";
import { DriveBanner } from "./DriveBanner";
import { ZohoBanner } from "./ZohoBanner";
import { Toolbar } from "./Toolbar";
import { StatCards } from "./StatCards";
import {
  CategoryValueChart,
  InvoiceStatusChart,
  PipelineChart,
  TopVendorsChart,
} from "./Charts";
import { KanbanBoard } from "@/features/pipeline/KanbanBoard";
import { VendorsTable } from "@/features/vendors/VendorsTable";
import { VendorDetailModal } from "@/features/vendors/VendorDetailModal";
import { Modal } from "@/components/Modal";
import { VendorForm } from "@/features/vendors/VendorForm";
import { GeneratePoModal } from "@/features/zoho/GeneratePoModal";
import { PurchaseOrdersPanel } from "@/features/purchase-orders/PurchaseOrdersPanel";
import { dashboardApi, vendorsApi, VendorQuery } from "@/lib/api";

export function DashboardPage() {
  const [query, setQuery] = useState<VendorQuery>({ pageSize: 100 });
  const [openVendorId, setOpenVendorId] = useState<string | null>(null);
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [generatingPo, setGeneratingPo] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: dashboardApi.stats,
  });

  const { data: vendorsPage, isLoading: vendorsLoading } = useQuery({
    queryKey: ["vendors", query],
    queryFn: () => vendorsApi.list(query),
    // Keep showing the previous list while a new filter/search loads (no blank flash).
    placeholderData: (prev) => prev,
  });

  const vendors = vendorsPage?.items ?? [];
  const total = vendorsPage?.total ?? 0;

  return (
    <div className="min-h-full flex flex-col">
      <Header />
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-6 space-y-5">
        <Toolbar
          query={query}
          onQueryChange={(p) => setQuery((q) => ({ ...q, ...p }))}
          onAddVendor={() => setCreatingVendor(true)}
          onGeneratePo={() => setGeneratingPo(true)}
          statsOpen={statsOpen}
          onToggleStats={() => setStatsOpen((v) => !v)}
          statusSlot={
            <>
              <ZohoBanner />
              <DriveBanner />
            </>
          }
        />

        {/* Stats stay out of the way until asked for (the "Stats" toolbar button). */}
        {statsOpen && stats && (
          <div className="space-y-4">
            <StatCards stats={stats} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PipelineChart stats={stats} />
              <CategoryValueChart stats={stats} />
              <InvoiceStatusChart stats={stats} />
              <TopVendorsChart stats={stats} />
            </div>
          </div>
        )}

        <PurchaseOrdersPanel />
        <KanbanBoard vendors={vendors} onOpenVendor={setOpenVendorId} />
        <VendorsTable
          vendors={vendors}
          total={total}
          loading={vendorsLoading}
          onOpenVendor={setOpenVendorId}
        />
      </main>
      <Footer />

      {openVendorId && (
        <VendorDetailModal vendorId={openVendorId} onClose={() => setOpenVendorId(null)} />
      )}
      {creatingVendor && (
        <Modal title="Add Vendor" onClose={() => setCreatingVendor(false)}>
          <VendorForm onClose={() => setCreatingVendor(false)} />
        </Modal>
      )}
      {generatingPo && <GeneratePoModal onClose={() => setGeneratingPo(false)} />}
    </div>
  );
}
