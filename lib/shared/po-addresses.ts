/** Billing addresses available for Keystone purchase orders. */
export const PO_BILLING_ADDRESSES = [
  {
    id: "bengaluru",
    label: "Bengaluru office — GSTIN 29AAMCK2232K1Z9",
    value: [
      "Keystone Commerce Private Limited",
      "5th Floor, Tower A, Dr Rajkumar Road",
      "Bengaluru, Karnataka-560103",
      "GSTIN: 29AAMCK2232K1Z9",
      "PAN: AAMCK2232K",
    ].join("\n"),
  },
  {
    id: "delhi",
    label: "Delhi office — GSTIN 07AAMCK2232K1ZF",
    value: [
      "Ground Floor, D-1, Innov8 Ras Vilas, Saket District Center, Saket Sub Post Office, Saket, South Delhi, Delhi, 110017",
      "Delhi Delhi 110017",
      "India",
      "GSTIN: 07AAMCK2232K1ZF",
    ].join("\n"),
  },
] as const;

export type PoBillingAddress = (typeof PO_BILLING_ADDRESSES)[number];
