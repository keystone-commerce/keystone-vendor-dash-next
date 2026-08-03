import { useMemo } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useState } from "react";
import { VENDOR_CATEGORY_LABELS, VendorDto, VendorStage } from "@shared";
import { formatInr, formatDate } from "@/lib/format";
import { SkeletonRows } from "@/components/Skeleton";

const STAGE_CHIP: Record<VendorStage, string> = {
  IN_TALKS: "bg-keystone-blue/10 text-keystone-blue",
  CATALOGUE_RECEIVED: "bg-orange/15 text-orange-deep",
  PURCHASE_MADE: "bg-keystone-green/10 text-keystone-green",
};

const STAGE_LABEL: Record<VendorStage, string> = {
  IN_TALKS: "In Talks",
  CATALOGUE_RECEIVED: "Catalogue Received",
  PURCHASE_MADE: "Purchase Made",
};

interface Props {
  vendors: VendorDto[];
  total: number;
  loading?: boolean;
  onOpenVendor: (id: string) => void;
}

export function VendorsTable({ vendors, total, loading = false, onOpenVendor }: Props) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo<ColumnDef<VendorDto>[]>(
    () => [
      { accessorKey: "name", header: "Vendor" },
      {
        accessorKey: "category",
        header: "Category",
        cell: (info) => VENDOR_CATEGORY_LABELS[info.getValue<VendorDto["category"]>()],
      },
      {
        accessorKey: "stage",
        header: "Stage",
        cell: (info) => {
          const stage = info.getValue<VendorStage>();
          return <span className={`chip ${STAGE_CHIP[stage]}`}>{STAGE_LABEL[stage]}</span>;
        },
      },
      { accessorKey: "contactName", header: "Contact", cell: (info) => info.getValue() ?? "—" },
      {
        accessorKey: "contractValue",
        header: "Value",
        cell: (info) => formatInr(info.getValue<number>()),
      },
      {
        accessorKey: "contractEnd",
        header: "Expires",
        cell: (info) => formatDate(info.getValue<string | null>()),
      },
      {
        // When the vendor was first added. Set by the database on insert, so it's
        // present on every row including ones created before this column existed.
        accessorKey: "createdAt",
        header: "Added",
        cell: (info) => formatDate(info.getValue<string>()),
      },
      {
        id: "docs",
        header: "Docs",
        cell: ({ row }) =>
          `${row.original.catalogueCount ?? 0} cat / ${row.original.billCount ?? 0} bill`,
      },
      {
        id: "zoho",
        header: "Zoho",
        // Surfaced here because a PO can't be approved until the vendor is linked.
        cell: ({ row }) =>
          row.original.zohoVendorId ? (
            <span className="chip bg-keystone-green/10 text-keystone-green">Linked</span>
          ) : (
            <span
              className="chip bg-keystone-amber/15 text-keystone-amber"
              title="Link this vendor to Zoho Books before raising/approving a PO"
            >
              Not linked
            </span>
          ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: vendors,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <section id="vendors-table" className="card overflow-hidden scroll-mt-4">
      <div className="p-4 border-b border-border flex items-baseline justify-between">
        <h2 className="text-lg font-bold">All Vendors</h2>
        <p className="text-xs text-muted">
          {vendors.length} of {total} shown
        </p>
      </div>
      {loading && vendors.length === 0 ? (
        <div className="p-4">
          <SkeletonRows rows={5} />
        </div>
      ) : vendors.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted">
          {total === 0
            ? "No vendors yet — click “+ Add Vendor” to add your first one."
            : "No vendors match your search or filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-orange-light/40">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => (
                    <th
                      key={h.id}
                      className="px-4 py-2 text-left font-semibold text-xs uppercase tracking-wide cursor-pointer select-none"
                      onClick={h.column.getToggleSortingHandler()}
                    >
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{ asc: " ↑", desc: " ↓" }[h.column.getIsSorted() as string] ?? null}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-border hover:bg-orange-light/30 cursor-pointer"
                  onClick={() => onOpenVendor(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
