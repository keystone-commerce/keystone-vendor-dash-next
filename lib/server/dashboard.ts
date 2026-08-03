import { BillStatus, VendorStage } from "@shared";
import { prisma } from "@/lib/prisma";

export async function dashboardStats() {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    totalVendors,
    pipelineByStage,
    contractValueByCategory,
    totalContractValueAgg,
    paidBillsAgg,
    outstandingBillsAgg,
    billStatusCounts,
    contractsExpiring,
    topVendors,
    totalBills,
  ] = await prisma.$transaction([
    prisma.vendor.count(),
    prisma.vendor.groupBy({ by: ["stage"], _count: { _all: true }, orderBy: { stage: "asc" } }),
    prisma.vendor.groupBy({ by: ["category"], _sum: { contractValue: true }, orderBy: { category: "asc" } }),
    prisma.vendor.aggregate({ _sum: { contractValue: true } }),
    prisma.bill.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { status: BillStatus.PAID } }),
    prisma.bill.aggregate({ _sum: { amount: true }, where: { status: { in: [BillStatus.UNPAID, BillStatus.OVERDUE] } } }),
    prisma.bill.groupBy({ by: ["status"], _count: { _all: true }, orderBy: { status: "asc" } }),
    prisma.vendor.count({ where: { contractEnd: { gte: now, lte: in30Days } } }),
    prisma.vendor.findMany({ orderBy: { contractValue: "desc" }, take: 5, select: { id: true, name: true, contractValue: true } }),
    prisma.bill.count(),
  ]);

  const pipeline: Record<VendorStage, number> = { IN_TALKS: 0, CATALOGUE_RECEIVED: 0, PURCHASE_MADE: 0 };
  for (const row of pipelineByStage) {
    const c = row._count as { _all: number } | undefined;
    pipeline[row.stage as VendorStage] = c?._all ?? 0;
  }
  const billStatus: Record<BillStatus, number> = { PAID: 0, UNPAID: 0, OVERDUE: 0 };
  for (const row of billStatusCounts) {
    const c = row._count as { _all: number } | undefined;
    billStatus[row.status as BillStatus] = c?._all ?? 0;
  }

  return {
    totals: {
      totalVendors,
      purchaseMade: pipeline.PURCHASE_MADE,
      totalContractValue: totalContractValueAgg._sum.contractValue ?? 0,
      billdPaid: paidBillsAgg._sum.amount ?? 0,
      paidBillCount: paidBillsAgg._count._all,
      outstanding: outstandingBillsAgg._sum.amount ?? 0,
      contractsExpiring,
      totalBills,
    },
    pipeline,
    contractValueByCategory: contractValueByCategory.map((row) => ({
      category: row.category,
      value: row._sum?.contractValue ?? 0,
    })),
    billStatus,
    topVendors,
  };
}
