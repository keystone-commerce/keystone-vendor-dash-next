import { formatInr } from "@/lib/format";
import type { DashboardStats } from "@/lib/api";

interface StatCardProps {
  label: string;
  value: string;
  subtext?: string;
  tone?: "default" | "green" | "amber" | "orange";
}

function StatCard({ label, value, subtext, tone = "default" }: StatCardProps) {
  const toneClass =
    tone === "green"
      ? "text-keystone-green"
      : tone === "amber"
        ? "text-keystone-amber"
        : tone === "orange"
          ? "text-orange-deep"
          : "text-ink";
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</div>
      {subtext && <div className="text-xs text-muted mt-1">{subtext}</div>}
    </div>
  );
}

export function StatCards({ stats }: { stats: DashboardStats }) {
  const t = stats.totals;
  const pipelineTotal = Object.values(stats.pipeline).reduce((a, b) => a + b, 0);
  const purchasePct = pipelineTotal > 0 ? Math.round((t.purchaseMade / pipelineTotal) * 100) : 0;
  const categoryCount = new Set(
    stats.contractValueByCategory.filter((r) => r.value > 0).map((r) => r.category),
  ).size;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      <StatCard
        label="Total Vendors"
        value={String(t.totalVendors)}
        subtext={`${categoryCount} categories`}
      />
      <StatCard
        label="Purchase Made"
        value={String(t.purchaseMade)}
        subtext={`${purchasePct}% of pipeline`}
        tone="orange"
      />
      <StatCard
        label="Total Contract Value"
        value={formatInr(t.totalContractValue)}
        subtext="Across all vendors"
      />
      <StatCard
        label="Billed (Paid)"
        value={formatInr(t.billdPaid)}
        subtext={`${t.paidBillCount} paid bill(s)`}
        tone="green"
      />
      <StatCard
        label="Total Bills"
        value={String(t.totalBills)}
        subtext="All synced bills"
        tone="orange"
      />
      <StatCard
        label="Outstanding"
        value={formatInr(t.outstanding)}
        subtext="Unpaid + overdue"
        tone="amber"
      />
      <StatCard
        label="Contracts Expiring"
        value={String(t.contractsExpiring)}
        subtext="Within 30 days"
        tone="orange"
      />
    </div>
  );
}
