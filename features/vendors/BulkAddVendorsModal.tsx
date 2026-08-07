import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { VENDOR_CATEGORIES } from "@shared";
import {
  vendorsApi,
  zohoApi,
  VendorImportResult,
  ZohoVendorImportResult,
  ZohoVendorDetailRefreshResult,
} from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { Modal } from "@/components/Modal";
import { SearchableSelect } from "@/components/SearchableSelect";

/**
 * Two ways to add many vendors at once. Admin only — the caller hides the button, and
 * both endpoints independently return 403.
 *
 * Presented together because they're the same job: "get a lot of vendors in". Which one
 * you want depends on where the vendors already exist, so the dialog says so rather than
 * making you guess from a button label.
 */
export function BulkAddVendorsModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<"csv" | "zoho" | "refresh" | null>(null);
  const [csvReport, setCsvReport] = useState<VendorImportResult | null>(null);
  const [zohoReport, setZohoReport] = useState<ZohoVendorImportResult | null>(null);
  const [refreshReport, setRefreshReport] = useState<ZohoVendorDetailRefreshResult | null>(null);
  const [category, setCategory] = useState<string>(VENDOR_CATEGORIES[0]);

  function download(text: string, filename: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onCsv(file: File) {
    setBusy("csv");
    setCsvReport(null);
    setZohoReport(null);
    setRefreshReport(null);
    try {
      const res = await vendorsApi.importCsv(file);
      setCsvReport(res);
      if (res.errors.length) {
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
      setBusy(null);
    }
  }

  async function onZoho() {
    setBusy("zoho");
    setCsvReport(null);
    setZohoReport(null);
    setRefreshReport(null);
    try {
      const res = await zohoApi.importVendors(category);
      setZohoReport(res);
      if (res.imported || res.linkedExisting) {
        toast.success(
          `Imported ${res.imported} and linked ${res.linkedExisting} existing vendor(s).`,
        );
        qc.invalidateQueries();
      } else if (res.totalFromZoho === 0) {
        toast("That Zoho organisation has no vendor contacts.");
      } else if (res.ambiguous.length || res.conflicts.length || res.duplicateZohoNames.length) {
        toast.error("Some Zoho vendors need review before they can be linked.");
      } else {
        toast(`Nothing new — all ${res.skippedExisting} Zoho vendor(s) are already here.`);
      }
    } catch (err) {
      toast.error(apiError(err, "Zoho import failed"));
    } finally {
      setBusy(null);
    }
  }

  async function onRefreshDetails() {
    setBusy("refresh");
    setCsvReport(null);
    setZohoReport(null);
    setRefreshReport(null);
    try {
      const res = await zohoApi.refreshVendorDetails();
      setRefreshReport(res);
      if (res.updated) {
        toast.success(`Refreshed ${res.updated} vendor(s) from Zoho.`);
        qc.invalidateQueries();
      } else if (!res.totalLinked) {
        toast("No dashboard vendors are linked to Zoho yet.");
      } else {
        toast("No new vendor details were available in Zoho.");
      }
    } catch (err) {
      toast.error(apiError(err, "Vendor detail refresh failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Bulk add vendors" onClose={onClose} maxWidthClass="max-w-2xl">
      <div className="space-y-5">
        {/* ── from Zoho ─────────────────────────────────────────────────────────── */}
        <section className="border border-border rounded-keystone p-4">
          <h3 className="font-semibold text-sm">Import from Zoho Books</h3>
          <p className="text-xs text-muted mt-1">
            Creates a vendor for every vendor contact in your Zoho organisation, each linked
            to its Zoho record. Bills already in Zoho then attach to the right vendor on the
            next sync — no manual matching. Nothing is created in Zoho.
          </p>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <label className="block">
              <span className="label">File them under</span>
              <div className="mt-1 w-[220px]">
                {/* Zoho has no category field, so one has to be chosen for the batch. */}
                <SearchableSelect
                  value={category}
                  onChange={setCategory}
                  options={VENDOR_CATEGORIES}
                  placeholder="Category"
                />
              </div>
            </label>
            <button className="btn-primary" disabled={busy !== null} onClick={onZoho}>
              {busy === "zoho" ? "Importing…" : "Import from Zoho"}
            </button>
            <button className="btn" disabled={busy !== null} onClick={onRefreshDetails}>
              {busy === "refresh" ? "Refreshing…" : "Refresh linked details"}
            </button>
          </div>

          <p className="text-xs text-muted mt-2">
            Refresh linked details fills missing mobile, email, GSTIN and
            addresses for vendors already linked to Zoho. It does not create or edit anything
            in Zoho.
          </p>

          {zohoReport && (
            <div className="mt-3 text-sm">
              <div>
                Imported <strong>{zohoReport.imported}</strong> · linked existing{" "}
                <strong>{zohoReport.linkedExisting}</strong> · skipped{" "}
                <strong>{zohoReport.skippedExisting}</strong> already present · Zoho has{" "}
                {zohoReport.totalFromZoho} vendor(s).
              </div>
              {zohoReport.importedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-green">
                  Imported vendors: {zohoReport.importedNames.join(", ")}
                </div>
              )}
              {zohoReport.linkedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-green">
                  Linked existing vendors: {zohoReport.linkedNames.join(", ")}
                </div>
              )}
              {zohoReport.skippedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-red">
                  Skipped vendors (already present): {zohoReport.skippedNames.join(", ")}
                </div>
              )}
              {zohoReport.ambiguous.length > 0 && (
                <div className="mt-2 text-xs text-keystone-amber">
                  ⚠ {zohoReport.ambiguous.length} ambiguous match(es) need review:{" "}
                  <span className="text-muted">{zohoReport.ambiguous.join(", ")}</span>
                </div>
              )}
              {zohoReport.conflicts.length > 0 && (
                <div className="mt-2 text-xs text-keystone-red">
                  ⚠ {zohoReport.conflicts.length} conflict(s) were not linked because the
                  dashboard vendor is already linked elsewhere:{" "}
                  <span className="text-muted">{zohoReport.conflicts.join(", ")}</span>
                </div>
              )}
              {zohoReport.duplicateZohoNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-amber">
                  ⚠ {zohoReport.duplicateZohoNames.length} duplicate Zoho name(s) were skipped:{" "}
                  <span className="text-muted">{zohoReport.duplicateZohoNames.join(", ")}</span>
                </div>
              )}
              {zohoReport.incomplete.length > 0 && (
                <div className="mt-2 text-xs text-keystone-amber">
                  ⚠ {zohoReport.incomplete.length} vendor(s) came across without mobile or
                  email. They&apos;re saved, but a purchase order can&apos;t
                  be raised for them until those are filled in:{" "}
                  <span className="text-muted">{zohoReport.incomplete.join(", ")}</span>
                </div>
              )}
            </div>
          )}
          {refreshReport && (
            <div className="mt-3 text-sm">
              Refreshed <strong>{refreshReport.refreshed}</strong> of{" "}
              <strong>{refreshReport.totalLinked}</strong> linked vendor(s); updated{" "}
              <strong>{refreshReport.updated}</strong>.
              {refreshReport.refreshedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-green">
                  Refreshed vendors: {refreshReport.refreshedNames.join(", ")}
                </div>
              )}
              {refreshReport.updatedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-green">
                  Updated vendors: {refreshReport.updatedNames.join(", ")}
                </div>
              )}
              {refreshReport.errorNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-red">
                  Could not refresh vendors: {refreshReport.errorNames.join(", ")}
                </div>
              )}
              {refreshReport.incomplete.length > 0 && (
                <div className="mt-2 text-xs text-keystone-amber">
                  Still incomplete ({refreshReport.incomplete.length}):{" "}
                  <span className="text-muted">{refreshReport.incomplete.join(", ")}</span>
                </div>
              )}
              {refreshReport.errors.length > 0 && (
                <div className="mt-2 text-xs text-keystone-red">
                  Could not refresh {refreshReport.errors.length} vendor(s):{" "}
                  <span>{refreshReport.errors.join("; ")}</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── from CSV ──────────────────────────────────────────────────────────── */}
        <section className="border border-border rounded-keystone p-4">
          <h3 className="font-semibold text-sm">Upload a CSV</h3>
          <p className="text-xs text-muted mt-1">
            For vendors that aren&apos;t in Zoho yet. Name, Category, Phone and Email are required;
            Contact Name is optional. One bad row rejects the whole file, so nothing lands
            half-imported — and re-uploading a corrected file won&apos;t duplicate anything.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // so the same file can be picked twice
                if (f) onCsv(f);
              }}
            />
            <button className="btn" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
              {busy === "csv" ? "Uploading…" : "Choose CSV file"}
            </button>
            <button
              className="btn"
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
          </div>

          {csvReport && csvReport.errors.length === 0 && (
            <div className="mt-3 text-sm">
              Imported <strong>{csvReport.imported}</strong> · skipped{" "}
              <strong>{csvReport.skippedExisting}</strong> already present · {csvReport.totalRows}{" "}
              row(s) in the file.
              {csvReport.importedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-green">
                  Imported vendors: {csvReport.importedNames.join(", ")}
                </div>
              )}
              {csvReport.skippedNames.length > 0 && (
                <div className="mt-2 text-xs text-keystone-red">
                  Skipped vendors (already in the dashboard): {csvReport.skippedNames.join(", ")}
                </div>
              )}
            </div>
          )}

          {csvReport && csvReport.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-sm text-keystone-red font-medium">
                Nothing was imported — {csvReport.errors.length} row(s) need fixing.
              </p>
              <ul className="divide-y divide-border border border-border rounded-keystone mt-2 max-h-[32vh] overflow-y-auto">
                {csvReport.errors.map((e, i) => (
                  <li key={i} className="flex gap-3 p-2 text-sm">
                    <span className="font-mono text-xs text-muted shrink-0 w-14">row {e.row}</span>
                    <span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
