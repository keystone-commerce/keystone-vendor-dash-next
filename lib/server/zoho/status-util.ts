import { BillStatus } from "@shared";

/** Map a Zoho bill/bill status to the dashboard's BillStatus. null → skip (void/cancelled). */
export function mapZohoStatus(zohoStatus: string): BillStatus | null {
  switch (zohoStatus.trim().toLowerCase()) {
    case "paid":
      return BillStatus.PAID;
    case "overdue":
      return BillStatus.OVERDUE;
    case "open":
    case "sent":
    case "partially_paid":
    case "draft":
    case "unpaid":
      return BillStatus.UNPAID;
    case "void":
    case "voided":
    case "cancelled":
      return null;
    default:
      return BillStatus.UNPAID;
  }
}
