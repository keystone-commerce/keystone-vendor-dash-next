import { useEffect } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartOptions,
  Legend,
  LinearScale,
  Tooltip,
} from "chart.js";
import { VENDOR_CATEGORY_LABELS } from "@shared";
import type { DashboardStats } from "@/lib/api";
import { formatInr } from "@/lib/format";
import { useTheme } from "@/lib/use-theme";

ChartJS.register(BarElement, CategoryScale, LinearScale, ArcElement, Tooltip, Legend);

const BRAND = {
  blue: "#2563eb",
  orange: "#F0862E",
  green: "#059669",
  rustLight: "#C97C4E",
  amber: "#d97706",
  red: "#dc2626",
  categoryPalette: [
    "#FF914D", // Raw Materials — orange
    "#7C3C1D", // Logistics — rust dark
    "#059669", // IT Services — green
    "#2563eb", // Packaging — blue
    "#d97706", // Consulting — amber
    "#8b5cf6", // Office Supplies — violet
    "#14b8a6", // Marketing — teal
  ],
};

const commonOpts: ChartOptions<any> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
};

/**
 * Chart.js paints axis labels, legends and grid lines with its own defaults (dark
 * grey), which is unreadable on a dark background. Sync those to the active theme.
 * Returns `isDark` so callers can re-key the canvas and force a repaint on switch.
 */
function useChartTheme() {
  const { isDark } = useTheme();
  useEffect(() => {
    ChartJS.defaults.color = isDark ? "#9A9188" : "#8A7A6E";
    ChartJS.defaults.borderColor = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";
  }, [isDark]);
  return isDark;
}

export function PipelineChart({ stats }: { stats: DashboardStats }) {
  const isDark = useChartTheme();
  const data = {
    labels: ["In Talks", "Catalogue Received", "Purchase Made"],
    datasets: [
      {
        label: "Vendors",
        data: [
          stats.pipeline.IN_TALKS,
          stats.pipeline.CATALOGUE_RECEIVED,
          stats.pipeline.PURCHASE_MADE,
        ],
        backgroundColor: [BRAND.blue, BRAND.orange, BRAND.green],
        borderRadius: 6,
      },
    ],
  };
  return (
    <ChartCard title="Vendor Pipeline">
      <Bar key={String(isDark)} data={data} options={{ ...commonOpts, scales: { y: { beginAtZero: true } } }} />
    </ChartCard>
  );
}

export function CategoryValueChart({ stats }: { stats: DashboardStats }) {
  const isDark = useChartTheme();
  const rows = stats.contractValueByCategory;
  const data = {
    labels: rows.map((r) => VENDOR_CATEGORY_LABELS[r.category]),
    datasets: [
      {
        label: "Contract Value",
        data: rows.map((r) => r.value / 100),
        backgroundColor: rows.map((_, i) => BRAND.categoryPalette[i % BRAND.categoryPalette.length]),
        borderRadius: 6,
      },
    ],
  };
  return (
    <ChartCard title="Contract Value by Category">
      <Bar
        key={String(isDark)}
        data={data}
        options={{
          ...commonOpts,
          scales: {
            y: {
              beginAtZero: true,
              ticks: {
                callback: (v) => `₹${Math.round(Number(v) / 1000)}k`,
              },
            },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => formatInr(Number(ctx.raw) * 100) } },
          },
        }}
      />
    </ChartCard>
  );
}

export function InvoiceStatusChart({ stats }: { stats: DashboardStats }) {
  const isDark = useChartTheme();
  const data = {
    labels: ["Paid", "Unpaid", "Overdue"],
    datasets: [
      {
        data: [stats.invoiceStatus.PAID, stats.invoiceStatus.UNPAID, stats.invoiceStatus.OVERDUE],
        backgroundColor: [BRAND.green, BRAND.amber, BRAND.red],
        borderWidth: 0,
      },
    ],
  };
  return (
    <ChartCard title="Invoice Status">
      <Doughnut
        key={String(isDark)}
        data={data}
        options={{ ...commonOpts, cutout: "60%", plugins: { legend: { display: true, position: "bottom" } } }}
      />
    </ChartCard>
  );
}

export function TopVendorsChart({ stats }: { stats: DashboardStats }) {
  const isDark = useChartTheme();
  const data = {
    labels: stats.topVendors.map((v) =>
      v.name.length > 18 ? v.name.slice(0, 18) + "…" : v.name,
    ),
    datasets: [
      {
        label: "Contract Value",
        data: stats.topVendors.map((v) => v.contractValue / 100),
        backgroundColor: BRAND.rustLight,
        borderRadius: 6,
      },
    ],
  };
  return (
    <ChartCard title="Top 5 Vendors by Contract Value">
      <Bar
        key={String(isDark)}
        data={data}
        options={{
          ...commonOpts,
          indexAxis: "y",
          scales: {
            x: {
              beginAtZero: true,
              ticks: { callback: (v) => `₹${Math.round(Number(v) / 1000)}k` },
            },
          },
          plugins: {
            tooltip: { callbacks: { label: (ctx) => formatInr(Number(ctx.raw) * 100) } },
          },
        }}
      />
    </ChartCard>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      <div className="h-64">{children}</div>
    </div>
  );
}
