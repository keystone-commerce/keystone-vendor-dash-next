import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  VENDOR_CATEGORIES,
  VendorCategory,
  VendorDto,
  gstinError,
  gstinWarning,
  parseGstin,
} from "@shared";
import { vendorsApi, zohoApi } from "@/lib/api";
import { apiError } from "@/lib/api-client";
import { SearchableSelect } from "@/components/SearchableSelect";
import ProgressButton from "@/components/ui/progress-button";

interface Props {
  vendor?: VendorDto;
  onClose: () => void;
}

/** contractValue is displayed and edited in rupees; DB stores paise. */
export function VendorForm({ vendor, onClose }: Props) {
  const qc = useQueryClient();
  const isEdit = Boolean(vendor);

  const [name, setName] = useState(vendor?.name ?? "");
  const [category, setCategory] = useState<VendorCategory>(vendor?.category ?? "Electronics");
  const [contactName, setContactName] = useState(vendor?.contactName ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [contractValue, setContractValue] = useState<number>(
    vendor ? Math.round(vendor.contractValue / 100) : 0,
  );
  const [rating, setRating] = useState<number>(vendor?.rating ?? 0);
  const [contractStart, setContractStart] = useState(
    vendor?.contractStart ? vendor.contractStart.slice(0, 10) : "",
  );
  const [contractEnd, setContractEnd] = useState(
    vendor?.contractEnd ? vendor.contractEnd.slice(0, 10) : "",
  );
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [gstin, setGstin] = useState(vendor?.gstin ?? "");
  const [gstAddress, setGstAddress] = useState(vendor?.gstAddress ?? "");
  const [billingAddress, setBillingAddress] = useState(vendor?.billingAddress ?? "");
  const [shippingAddress, setShippingAddress] = useState(vendor?.shippingAddress ?? "");

  // GSTIN is optional, so only validate once something's been typed.
  // gstinError = hard (blocks submit); gstinWarning = advisory check-digit hint.
  const gstinProblem = gstin.trim() ? gstinError(gstin) : null;
  const gstinNote = gstin.trim() ? gstinWarning(gstin) : null;
  const gstinParts = gstin.trim() ? parseGstin(gstin) : null;
  const [zohoVendorId, setZohoVendorId] = useState(vendor?.zohoVendorId ?? "");

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        category,
        // Sent as actual values (not `|| undefined`) — these are required, and omitting
        // them from a PATCH would let an existing vendor keep an empty contact block.
        contactName: contactName.trim() || null,
        phone: phone.trim(),
        email: email.trim(),
        contractValue: Math.round(contractValue * 100),
        rating,
        contractStart: contractStart || undefined,
        contractEnd: contractEnd || undefined,
        notes: notes || undefined,
        // Send null (not undefined) on clear so an edit can actually remove a
        // wrongly-entered GSTIN/address — undefined would be omitted from the PATCH.
        gstin: gstin.trim() ? gstin.trim().toUpperCase() : null,
        gstAddress: gstAddress.trim() ? gstAddress.trim() : null,
        billingAddress: billingAddress.trim() ? billingAddress.trim() : null,
        shippingAddress: shippingAddress.trim() ? shippingAddress.trim() : null,
      };
      if (isEdit) {
        const updated = await vendorsApi.update(vendor!.id, payload);
        // Zoho link lives on a dedicated endpoint; only call it when it changed.
        if ((zohoVendorId || "") !== (vendor!.zohoVendorId ?? "")) {
          return vendorsApi.setZohoLink(vendor!.id, zohoVendorId.trim() || null);
        }
        return updated;
      }
      return vendorsApi.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? "Vendor updated." : "Vendor added.");
      qc.invalidateQueries();
      onClose();
    },
    onError: (err) => toast.error(apiError(err, "Save failed")),
  });

  // Create a matching vendor in Zoho Books and save its id on this vendor (the durable link).
  const linkZoho = useMutation({
    mutationFn: () => zohoApi.createAndLinkVendor(vendor!.id),
    onSuccess: (res) => {
      setZohoVendorId(res.zohoVendorId);
      toast.success(
        res.alreadyLinked
          ? "Already linked to Zoho."
          : res.matchedExisting
            ? "Found the existing Zoho vendor and linked it."
          : `Created in Zoho & linked (id ${res.zohoVendorId}).`,
      );
      qc.invalidateQueries();
    },
    onError: (err) => toast.error(apiError(err, "Could not create the Zoho vendor")),
  });

  return (
    <form
      className="grid grid-cols-1 md:grid-cols-2 gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (phone.length !== 10) {
          toast.error("Mobile number must be exactly 10 digits.");
          return;
        }
        if (!email.trim()) {
          toast.error("Email is required — it appears on every purchase order.");
          return;
        }
        if (gstinProblem) {
          toast.error(gstinProblem);
          return;
        }
        mutation.mutate();
      }}
    >
      <label className="block md:col-span-2">
        <span className="label">Name *</span>
        <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="block">
        <span className="label">Category</span>
        <div className="mt-1">
          <SearchableSelect
            value={category}
            onChange={(v) => setCategory(v as VendorCategory)}
            options={VENDOR_CATEGORIES}
            placeholder="Select a category"
          />
        </div>
      </label>
      {/* Contact person is optional because some existing Zoho vendors do not have one. */}
      <label className="block">
        <span className="label">Contact person</span>
        <input
          className="input mt-1"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="label">Mobile *</span>
        <input
          className="input mt-1"
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit number"
          value={phone}
          // Keep digits only and never allow more than 10.
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
          required
        />
      </label>
      <label className="block">
        <span className="label">Email *</span>
        <input
          className="input mt-1"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label className="block">
        <span className="label">GSTIN</span>
        <input
          className={`input mt-1 uppercase ${gstinProblem ? "border-keystone-red" : ""}`}
          placeholder="29ABCDE1234F1Z5"
          maxLength={15}
          value={gstin}
          // A GSTIN is 15 chars: 2-digit state code, 10-char PAN, entity digit, 'Z',
          // check digit. Strip anything that can't appear so typos are caught early.
          onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15))}
        />
        {gstinProblem && <span className="text-xs text-keystone-red mt-1 block">{gstinProblem}</span>}
        {!gstinProblem && gstinNote && (
          <span className="text-xs text-keystone-amber mt-1 block">{gstinNote}</span>
        )}
        {!gstinProblem && gstinParts?.state && (
          <span className="text-xs text-muted mt-1 block">
            {gstinParts.state}
            {gstinParts.entityType ? ` · ${gstinParts.entityType}` : ""}
          </span>
        )}
      </label>
      <label className="block">
        <span className="label">Full address (registered)</span>
        <input
          className="input mt-1"
          placeholder="Street, city, state, PIN"
          value={gstAddress}
          onChange={(e) => setGstAddress(e.target.value)}
        />
      </label>

      {/* Pushed to Zoho as the contact's billing_address / shipping_address when the
          vendor is created there, and printed on the PO. */}
      <label className="block">
        <span className="label">Billing address</span>
        <input
          className="input mt-1"
          placeholder="Where the vendor invoices from"
          value={billingAddress}
          onChange={(e) => setBillingAddress(e.target.value)}
        />
      </label>
      {/* The label is explicit (htmlFor/id) rather than wrapping the input: an implicit
          label containing both a button and an input can bind to the button, leaving the
          input with no accessible name. */}
      <div className="block">
        <div className="flex items-center justify-between">
          <label className="label" htmlFor="vendor-shipping-address">
            Shipping address
          </label>
          <button
            type="button"
            className="text-xs text-orange-deep hover:underline disabled:opacity-40 disabled:no-underline"
            disabled={!billingAddress.trim()}
            onClick={() => setShippingAddress(billingAddress)}
          >
            same as billing
          </button>
        </div>
        <input
          id="vendor-shipping-address"
          className="input mt-1"
          placeholder="Where goods dispatch from"
          value={shippingAddress}
          onChange={(e) => setShippingAddress(e.target.value)}
        />
      </div>
      <label className="block">
        <span className="label">Contract value (₹)</span>
        <input
          className="input mt-1"
          type="number"
          min={0}
          value={contractValue}
          onChange={(e) => setContractValue(Number(e.target.value))}
        />
      </label>
      <label className="block">
        <span className="label">Rating (0–5)</span>
        <input
          className="input mt-1"
          type="number"
          min={0}
          max={5}
          value={rating}
          onChange={(e) => setRating(Number(e.target.value))}
        />
      </label>
      <label className="block">
        <span className="label">Contract start</span>
        <input
          className="input mt-1"
          type="date"
          value={contractStart}
          onChange={(e) => setContractStart(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="label">Contract end</span>
        <input
          className="input mt-1"
          type="date"
          value={contractEnd}
          onChange={(e) => setContractEnd(e.target.value)}
        />
      </label>
      {isEdit && (
        <div className="block md:col-span-2">
          <span className="label">Zoho Books vendor</span>
          {zohoVendorId ? (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <span className="chip bg-keystone-green/10 text-keystone-green">Linked ✓</span>
              <input
                className="input flex-1 min-w-[200px]"
                value={zohoVendorId}
                onChange={(e) => setZohoVendorId(e.target.value)}
              />
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="btn-primary"
                disabled={linkZoho.isPending}
                onClick={() => linkZoho.mutate()}
              >
                {linkZoho.isPending ? "Creating in Zoho…" : "Create in Zoho & link"}
              </button>
              <input
                className="input flex-1 min-w-[180px]"
                value={zohoVendorId}
                onChange={(e) => setZohoVendorId(e.target.value)}
                placeholder="…or paste an existing Zoho vendor id"
              />
            </div>
          )}
          <span className="text-xs text-muted mt-1 block">
            "Create in Zoho & link" makes this vendor in Zoho Books and saves its id here — so
            Purchase Orders auto-fill it and bills auto-attach. One-time per vendor.
          </span>
        </div>
      )}
      <label className="block md:col-span-2">
        <span className="label">Notes</span>
        <textarea
          className="input mt-1"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="md:col-span-2 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <ProgressButton
          type="submit"
          label={isEdit ? "Save changes" : "Add vendor"}
          loadingLabel="Saving…"
          loading={mutation.isPending}
          className="!rounded-keystone h-[38px] text-sm"
        />
      </div>
    </form>
  );
}
