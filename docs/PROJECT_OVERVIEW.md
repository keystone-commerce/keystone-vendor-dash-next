# Keystone Vendor Dashboard — Project Overview

A complete technical description of this codebase, written so someone (or something)
with no prior context can work on it. Facts here were read out of the repository, not
recalled.

- **Repository:** `keystone-commerce/keystone-vendor-dash-next`
- **Organisation:** Keystone Commerce Private Limited (brand: **Liwip**)
- **Deployed on:** Vercel · **Database:** AWS RDS PostgreSQL 15
- **Status:** in production, in active development

---

## 1. What the product does

An internal procurement tool. Before it existed, vendor data lived in spreadsheets,
catalogues in Google Drive with inconsistent filenames, and financial records in Zoho
Books that only the accountant could see. Purchase orders were raised informally over
chat with no approval trail.

The app puts all of that in one place:

1. **Vendors** move through a 3-stage pipeline: `IN_TALKS → CATALOGUE_RECEIVED → PURCHASE_MADE`
2. **Catalogues** (price lists with per-item pricing, UOM, HSN) attach to vendors, stored in Google Drive
3. **Purchase orders** follow *submit → approve → dispatch*, producing a branded PDF on
   Keystone letterhead and creating the PO in Zoho Books on approval
4. **Bills** sync from Zoho Books, so procurement can see what's owed without Zoho access

### Explicit non-goals

- Not an accounting system — Zoho Books stays the financial source of truth
- No payments or banking; payment status is **read** from Zoho, never written
- Internal only, not customer-facing
- No inventory or stock management

---

## 2. Tech stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | **Next.js** (App Router) | 14.2 | One deployable serves UI *and* API |
| Language | TypeScript | 5.7 | Types shared between client and server |
| UI | React | 18.3 | |
| Styling | Tailwind CSS | 3.4 | RGB-channel CSS variables so opacity modifiers work; `darkMode: "class"` |
| Components | shadcn/ui pattern + Radix Slot | — | Copy-in components under `components/ui/` |
| Animation | framer-motion | 12 | Theme-toggle transition |
| Icons | lucide-react | 1.x | |
| Server state | TanStack Query | 5 | Caching, invalidation, background refetch |
| Client state | Zustand | 5 | Persisted auth session |
| Tables | TanStack Table | 8 | Vendor table |
| Charts | Chart.js + react-chartjs-2 | 4 | Dashboard analytics |
| Forms | react-hook-form + @hookform/resolvers | 7 | |
| Validation | Zod | 3 | Declared in `lib/shared/schemas.ts` — **note §9** |
| ORM | Prisma | 6.2 | Type-safe access + versioned migrations |
| Database | PostgreSQL (AWS RDS) | 15 | **No built-in pooler** — see §7 |
| Auth | jsonwebtoken + bcryptjs | — | JWT access/refresh; bcrypt-hashed OTP codes |
| PDF | pdf-lib | 1.17 | No native deps, so it runs on serverless |
| Email | Gmail API (googleapis) with nodemailer SMTP fallback | 144 / 6 | |
| Files | Google Drive API | via googleapis | Catalogue storage |
| HTTP client | axios | 1.x | With token-refresh interceptor |
| Toasts | sonner | 1.x | Theme-aware |
| Serverless helpers | @vercel/functions | 3.x | `waitUntil` for post-response work |

**Package manager: pnpm** (`pnpm-lock.yaml` is committed).

### Why one Next.js app

An earlier iteration used a separate NestJS API. Consolidating removed a deployment
target, eliminated CORS handling, and let both sides import the same types from
`lib/shared/` — so changing a shared enum now fails the build on client *and* server
instead of drifting silently.

---

## 3. Directory layout

```text
app/                        Next.js App Router
  api/v1/**/route.ts        45 API route handlers
  login/page.tsx            login route
  page.tsx                  dashboard route
  layout.tsx                root layout + theme bootstrap script
  icon.svg                  favicon (Next.js convention)
  globals.css               Tailwind + design tokens

features/                   client UI, grouped by domain
  auth/                     LoginPage, RequireAuth
  dashboard/                DashboardPage, Toolbar, StatCards, Charts, ZohoBanner, DriveBanner
  layout/                   Header, Footer
  pipeline/                 KanbanBoard
  purchase-orders/          PurchaseOrdersPanel
  team/                     TeamModal
  vendors/                  VendorsTable, VendorForm, VendorDetailModal, BulkAddVendorsModal
  zoho/                     GeneratePoModal

components/                 shared UI
  ui/                       shadcn-style: progress-button, show-more, interactive-hover-button…
  Modal.tsx, SearchableSelect.tsx, …

lib/
  api.ts                    typed API client (one function per endpoint)
  api-client.ts             axios instance, JWT + refresh + multipart interceptors
  auth-store.ts             Zustand persisted session
  format.ts, use-theme.tsx  formatters, theme context
  shared/                   imported by BOTH client and server
    types.ts                DTOs
    enums.ts                UserRole, VendorStage, VENDOR_CATEGORIES (28), …
    schemas.ts              Zod schemas
    gstin.ts                GSTIN parsing/validation + GST_STATE_CODES
    money.ts                paise/rupee helpers
  server/                   server-only business logic
    auth.ts                 requireUser / requireRole / HttpError
    http.ts                 handle() — turns HttpError into the right status
    vendors.ts              vendor CRUD, CSV export + import
    bills.ts, catalogues.ts, users.ts, dashboard.ts
    purchase-orders.ts      submit / edit / approve / reject, PDF, notifications
    po-pdf.ts               the Keystone PO document (pdf-lib)
    stage-engine.ts         pipeline transitions + auto-advance
    mail.ts                 Gmail API, SMTP fallback, dev console fallback
    otp.ts, audit.ts, csv.ts
    assets/                 keystone-logo.jpg, liwip-logo.png (embedded in the PDF)
    zoho/                   auth.ts, client.ts, service.ts, matcher.ts, status-util.ts
    drive/                  google.ts, mock.ts, client-factory.ts, service.ts, matcher.ts…

prisma/
  schema.prisma             12 models, 6 enums
  migrations/               13 migrations
  seed.ts, create-admin.ts

docs/                       PRD.md, SETUP_NEW_DATABASE.md, ZOHO_WEBHOOK_SETUP.md,
                            PROJECT_OVERVIEW.md
public/                     liwip-logo.svg
```

### Layer discipline

Route handlers stay thin — authenticate, parse, delegate:

```ts
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(async () => {
    const user = requireRole(req, "ADMIN", "PROCUREMENT_MEMBER");
    return attachCatalogue(params.id, await req.json(), user.userId);
  });
}
```

`handle()` converts a thrown `HttpError(409, "…")` into the right HTTP status, so business
code in `lib/server/**` never touches HTTP concerns.

---

## 4. Data model

12 models. `Vendor` is the hub; children cascade on delete.

| Model | Table | Purpose |
|---|---|---|
| `User` | `users` | Team member + role |
| `Vendor` | `vendors` | Core record: contact, contract, GST details, `zohoVendorId` link, billing/shipping addresses (29 fields) |
| `Catalogue` / `CatalogueItem` | `catalogues`, `catalogue_items` | Price lists; items carry unit price, UOM, HSN |
| `Bill` | `bills` | Synced from Zoho or added manually |
| `PurchaseOrder` | `purchase_orders` | Line items as JSON, status, decision audit, `deliveryDate` |
| `ZohoUnmatchedBill` | `zoho_unmatched_bills` | Review queue — a Zoho bill whose vendor couldn't be matched |
| `DriveUnassignedFile` / `IgnoredFile` / `FileAssignment` | | Drive triage + remembered mappings |
| `AuditLog` | `audit_logs` | Every meaningful action; `userId` is `onDelete: SetNull` |
| `LoginOtp` | `login_otps` | bcrypt-hashed one-time sign-in codes |

### Enums

```text
UserRole             ADMIN | PROCUREMENT_MEMBER | VIEWER
VendorStage          IN_TALKS | CATALOGUE_RECEIVED | PURCHASE_MADE
VendorStatus         ACTIVE | ON_HOLD | BLACKLISTED
BillStatus           PAID | UNPAID | OVERDUE
PurchaseOrderStatus  PENDING | APPROVED | REJECTED
DocumentSource       MANUAL_UPLOAD | DRIVE_SYNC | ZOHO_SYNC
```

**Vendor categories are NOT a Postgres enum.** They're a code-managed list of 28 strings in
`lib/shared/enums.ts` (`VENDOR_CATEGORIES`), stored as `String`. Migration
`20260731120000_vendor_category_to_text` converted the old enum to text precisely so that
adding a category is a code change, not a migration.

### Money

Stored as **integer paise** (₹1 = 100) to avoid floating-point drift. `lib/shared/money.ts`
has the converters.

> ⚠️ **Known limitation:** money columns are `INT4`, capping a single value at ~₹21.4
> crore. Fine today; would need `BIGINT` for larger contracts.

### Migrations (13, in order)

```text
20260718065457_init
20260718120000_add_zoho_invoice_source
20260720122733_catalogue_items
20260720172313_purchase_orders
20260721082959_zoho_unmatched
20260721105017_drive_unassigned
20260729120000_vendor_gst_fields
20260730120000_login_otps
20260731120000_vendor_category_to_text
20260731140000_rename_invoice_to_bill
20260803120000_rename_bills_fk_constraint
20260804120000_vendor_billing_shipping_address
20260804130000_po_delivery_date
```

Two of these exist because earlier schema changes were applied by hand with `db push` and
never recorded — a database built from migrations alone was broken. **Always use
`prisma migrate deploy`, never `db push`.**

---

## 5. Roles and permissions

| Role | Can do |
|---|---|
| **ADMIN** | Everything: approve/reject POs, manage the team, link vendors to Zoho, delete vendors, bulk-import vendors, open records in Zoho |
| **PROCUREMENT_MEMBER** | Create/edit vendors, upload catalogues, submit POs, edit **their own** pending/rejected POs |
| **VIEWER** | Read-only |

Enforced server-side via `requireRole()`. Submitting and approving are deliberately
separate permissions, so a member cannot self-approve spend.

### Authentication

**Passwordless.** No sign-up screen and no password field:

1. User enters their email
2. A 6-digit code is emailed (valid 10 minutes), stored **bcrypt-hashed** in `login_otps`
3. On verify → JWT access token (15 min) + refresh token (7 days)
4. `lib/api-client.ts` refreshes transparently on 401

The **first** admin on a fresh database must be created out of band:

```bash
npx ts-node prisma/create-admin.ts you@company.com "Your Name"
```

Re-running promotes an existing user, so it doubles as the "grant admin" tool.

---

## 6. Key business flows

### Purchase order lifecycle

```text
Procurement submits  →  PENDING   (PDF emailed to all ADMIN users)
Admin approves       →  APPROVED  (created in Zoho Books, PDF emailed to vendor + submitter)
Admin rejects        →  REJECTED  (reason recorded, submitter notified)
Edit a REJECTED one  →  back to PENDING, reason cleared, approvers re-notified
```

Rules that are enforced, not merely suggested:

- **APPROVED POs cannot be edited** (409). They already exist in Zoho Books; editing here
  would leave the dashboard and Zoho disagreeing about what was ordered.
- The **vendor is fixed** once a PO is raised — changing it would invalidate the Zoho link.
- Editing **re-notifies approvers**, because an admin may be holding an emailed PDF of the
  previous version.
- A PO **cannot be raised** for a vendor missing contact person / mobile / email
  (`assertVendorContactable`) — otherwise the document reaches the supplier with blank rows.
- **Item Code is required** on every line; **HSN** must be 4–8 digits.
- Approval requires the vendor to be **linked to Zoho** (`zohoVendorId`).

### Approver notifications

Recipients are **the ADMIN users read from the database**, not configuration. There used to
be a `PO_APPROVER_EMAIL` env var; it bypassed the role check and could send approval
requests — with the PO PDF attached — to someone not permitted to approve. It was removed
deliberately. Do not reintroduce it.

### Bill sync from Zoho

Three paths, all calling the same `runSync()`:

| Path | Latency |
|---|---|
| Zoho webhook → `/api/v1/zoho/webhook` | ~1–2 s |
| Vercel Cron → `/api/v1/cron/sync` (`*/15 * * * *`) | ≤ 15 min |
| "Sync now" button | on demand |

`runSync()` fetches bills (paged, `per_page=200`, looping on `has_more_page`), matches each
to a vendor, and either upserts a `Bill` or files it in `ZohoUnmatchedBill`. **The unmatched
queue is rebuilt from scratch on every sync** — deleting rows from it is pointless, they
return on the next run.

Vendor matching order: `zohoVendorId` → exact name (case-insensitive) → partial name either
direction.

### Google Drive catalogues

Files are matched to vendors by filename prefix. Unmatched files land in
`DriveUnassignedFile` for triage; assignments are remembered in `FileAssignment` so the same
file pattern auto-matches next time. `DRIVE_ENABLED` switches between the real client and an
**in-memory mock** — with it unset, uploads appear to succeed and go nowhere.

### The PO PDF (`lib/server/po-pdf.ts`)

Hand-drawn with pdf-lib to match Keystone's official letterhead: three logos baseline-aligned,
header grid, supplier block, billing/delivery block, 10-column material table, commercial
summary with CGST/SGST-vs-IGST split, 20 standard terms, signature blocks.

Things a maintainer needs to know:

- **Configurable output:** by default, `buildPoPdf()` uses a `PENDING` status, shows the
  `(assigned on approval)` PO-number placeholder, uses `30 Days` payment terms, and falls
  back to Keystone's standard billing and delivery addresses. Callers can override the
  status, status visibility, PO-number placeholder, payment terms, vendor code, supplier
  details, billing/delivery addresses, delivery date, and line-level HSN, item code, brand,
  UOM, and GST percentage. Set `blank: true` for an empty fill-in form; it hides the status,
  date, and monetary values. Generated PDF/DOCX artifacts are kept out of the repository.

- **Helvetica is WinAnsi-encoded** — it cannot render `₹` or `…`. Everything goes through
  `ascii()`, and money is written as `Rs.` followed by the amount.
- Text **wraps** rather than truncating; rows grow to fit the tallest cell.
- The table sizes to the actual item count, and everything below it flows accordingly.
- Long values shrink to fit (`drawRNum`) rather than overflowing their cell.
- `blank: true` renders an empty form (no status line, no date, no amounts), so a printed
  template generated from the app can't drift from the live PO layout.
- The same document is used before and after approval; only the status line changes.
  Zoho's own plain PDF is never surfaced to the vendor.

---

## 7. Environment variables

```bash
# Database — AWS RDS
DATABASE_URL   # instance endpoint :5432, ?sslmode=require&connection_limit=5
DIRECT_URL     # same, without connection_limit

# Auth
JWT_ACCESS_SECRET  JWT_REFRESH_SECRET  JWT_ACCESS_TTL(15m)  JWT_REFRESH_TTL(7d)
APP_URL            # used in email links; falls back to the Vercel URL

# Zoho Books
ZOHO_ENABLED(true)  ZOHO_DC(in)  ZOHO_CLIENT_ID  ZOHO_CLIENT_SECRET
ZOHO_REFRESH_TOKEN  ZOHO_ORGANIZATION_ID
ZOHO_INVOICE_SOURCE # "bills" (supplier side — the procurement default) | "invoices"

# Sync secrets
ZOHO_WEBHOOK_SECRET  # in the Zoho workflow URL as ?token=…
CRON_SECRET          # Vercel sends it as Authorization: Bearer …

# Mail — Gmail OAuth is preferred; SMTP_* is a legacy fallback
GMAIL_OAUTH_CLIENT_ID  GMAIL_OAUTH_CLIENT_SECRET  GMAIL_OAUTH_REFRESH_TOKEN
GMAIL_SENDER_EMAIL     GMAIL_SENDER_NAME

# Google Drive
DRIVE_ENABLED(true)  DRIVE_CATALOGUES_FOLDER_ID  DRIVE_SERVICE_ACCOUNT_JSON
GOOGLE_DRIVE_CLIENT_ID  GOOGLE_DRIVE_CLIENT_SECRET  GOOGLE_DRIVE_REFRESH_TOKEN
GOOGLE_DRIVE_FOLDER_ID
```

### Traps that have each caused a real outage

| | |
|---|---|
| **Paste only the *value* into Vercel** | No `DATABASE_URL=`, no quotes. A leading `"` gives `the URL must start with the protocol postgresql://` — the variable is read but rejected before any connection |
| **Percent-encode the DB password** | `\| ) [ * ] ? @ # /` must be escaped in a URL (`%7C`, `%29`…). Prisma decodes it. pgAdmin and `PGPASSWORD` want the **decoded** form |
| **`?sslmode=require`** | RDS refuses plaintext |
| **`connection_limit` on `DATABASE_URL` only** | RDS has no pooler; each warm serverless instance holds its own pool. The instance allows 79 connections, ~8 reserved by AWS. Use **RDS Proxy** if you outgrow it |
| **`DIRECT_URL` is not needed to serve traffic** | Required by `prisma migrate` / `prisma validate`; `prisma generate` and Prisma Client work without it |
| **`CRON_SECRET` fails closed** | `/api/v1/cron/sync` returns **503** without it. It used to skip the check when unset, leaving the endpoint publicly callable |
| **`ZOHO_ENABLED` must be `"true"`** | Otherwise demo mode: POs get fake `PO-MOCK-…` numbers and never reach Zoho |
| **`DRIVE_ENABLED` must be `"true"`** | Otherwise a mock Drive silently swallows uploads |

---

## 8. Zoho Books integration — the hard-won details

### OAuth scopes

Generated from a **Self Client** in the Zoho API Console. Scopes are frozen into the refresh
token at issue time — **they cannot be added later**; a new token is required.

```text
ZohoBooks.bills.READ,ZohoBooks.bills.CREATE,ZohoBooks.purchaseorders.READ,
ZohoBooks.purchaseorders.CREATE,ZohoBooks.contacts.READ,ZohoBooks.contacts.CREATE,
ZohoBooks.settings.READ,ZohoBooks.settings.CREATE,ZohoBooks.accountants.READ
```

Two of those are easy to get wrong because the scope name doesn't match the endpoint:

- **Items use `settings`, not `items`.** There is no `ZohoBooks.items.*` scope.
- **`/chartofaccounts` uses `accountants.READ`, not `settings.READ`.** Without it, PO
  approval fails while resolving the purchase account for a new item.

### The API changes shape depending on the organisation

This is the single most important thing to understand. **Identical code, different org
configuration, different result.** Every one of these was found the hard way:

| Symptom | Cause |
|---|---|
| `{"code":8,"message":"Invalid Element gst_no"}` | The **organisation** isn't GST-registered, so contact GST fields don't exist. Now guarded by an `orgSupportsGst()` check |
| `{"code":110802,"message":"Specify either a Tax or Tax Exemption or Reverse Charge."}` | The organisation **is** GST-registered, so every PO line must declare a tax. Resolved via `GET /settings/taxes` → `tax_id`, cached 60 s |
| `Invalid Element hsn_or_sac` | HSN belongs on the **item master**, not the PO line |
| `search_text has less than 100 characters` | Zoho caps `search_text` at 100 and item names at 100. Capped at 90/100 |
| `too many requests continuously` | Token-refresh rate limit, usually from repeated restarts clearing the in-memory token cache. Waits 15–30 min; cannot be forced |

Other integration facts worth knowing:

- **Contact detail requires a second call.** `GET /contacts` returns id, name, first/last
  name, email, phone — but **not** `contact_persons`, addresses or `gst_no`. Only
  `GET /contacts/{id}` has them. The person's name lives in `contact_persons[]`; the
  top-level `first_name`/`last_name` come back empty.
- **A Bill needs `vendor_id`, an Invoice needs `customer_id`** — the counterparty key follows
  the module.
- **Zoho has no idempotency key.** A retry after a successful POST creates a duplicate. The
  bill-create path therefore never lets a failed audit write surface as an error.
- **Item creation is irreversible**, so all line taxes are resolved *before* any
  `POST /items` — otherwise a rejected PO leaves stray item masters behind.
- **Switching organisation invalidates every `zohoVendorId`**; all vendors must be re-linked.
- The app is read-mostly: 11 endpoints, all `GET` or `POST`. **It never issues a `DELETE`**,
  so nothing in the dashboard can delete anything in Zoho.

---

## 9. Conventions and gotchas for a new contributor

**Validation is done with `assert*` helpers that throw `HttpError`, not with Zod.** The Zod
schemas in `lib/shared/schemas.ts` exist and are exported, but the vendor create/update path
does **not** parse them — it calls `assertValidGstin()`, `assertContactDetails()` and so on.
Follow the surrounding idiom; don't assume a schema is enforced because it exists.

**Batch database work; don't loop per row.** RDS round-trips measure ~45 ms. The bill sync
originally issued 5–6 sequential queries per bill, which at 400 bills exceeded the 60-second
function limit and was silently killed mid-loop — bills after the cutoff simply never
arrived, and because the audit row is written last, nothing recorded that it happened.
Read once into a Map, compare in memory, write with `createMany`.

**`maxDuration = 60`** on sync routes. That is a hard ceiling.

**Money is paise everywhere** in the database and DTOs; convert at the edges.

**Zoho's snake_case field names are the wire format** — `invoice_id`, `bill_number`. Do not
rename them to match internal vocabulary. A blanket Invoice→Bill rename previously broke
three things this way, including collapsing a `"bills" | "invoices"` union to
`"bills" | "bills"`.

**Verify empirically rather than trusting an edit landed.** Scripted find-and-replace has
silently matched nothing more than once in this codebase (CRLF line endings are a common
cause). This project has a habit of decoding generated PDFs to check text positions,
sampling canvas pixels to confirm chart colours, and querying the database before and after
a write. Keep it.

**Uploads must not inherit the JSON content type.** `lib/api-client.ts` sets
`Content-Type: application/json` globally; a request interceptor deletes it for `FormData`,
because only the browser can set the multipart boundary. This class of bug is invisible to
`curl -F`.

**Local `.env` may point at the production database.** Check before running anything
destructive. Mail is live too — submitting a PO locally really emails the admins. Blank
`GMAIL_OAUTH_REFRESH_TOKEN` to make the mailer log to the console instead.

---

## 10. Local setup

```bash
pnpm install
cp .env.example .env          # then fill it in
npx prisma generate
npx prisma migrate deploy     # expect 13 migrations, 12 app tables + _prisma_migrations
npx ts-node prisma/create-admin.ts you@company.com "Your Name"
pnpm dev                      # http://localhost:3000
```

`docker-compose.yml` provides a local Postgres on `127.0.0.1:5433` if you'd rather not point
at RDS — strongly preferred for development.

Commands: `pnpm dev` · `pnpm build` (`prisma generate && next build`) · `pnpm typecheck` ·
`pnpm lint` · `pnpm prisma:deploy` · `pnpm create-admin`

**ESLint is not configured** — `pnpm lint` triggers Next's interactive setup. `pnpm typecheck`
is the real gate, alongside `next build`.

---

## 11. Current state and open work

`main` is at PR **#12**. This snapshot was refreshed for PR **#16** on 2026-08-06 at
commit `5b0e7f9`:

| Branch | PR | Contents |
|---|---|---|
| `fix/zoho-po-line-tax` | — | **Blocking production.** Sends `tax_id` on PO lines (110802 fix), preflights taxes before item creation, 60 s cache TTL |
| `feat/import-vendors-from-zoho` | — | Admin action creating dashboard vendors from Zoho contacts, pre-linked so bills auto-match |
| `codex/zoho-dashboard-and-pdf-updates` | **#16** | Zoho vendor-detail refresh, dashboard counts/searchable controls, PO PDF generator updates |

### Known gaps

1. **Bill sync is still row-at-a-time** — 5–6 queries per bill against a 60 s limit. Fine at
   ~160 bills, not beyond. The fix (read once, match in memory, skip unchanged, `createMany`)
   is designed but not implemented.
2. **No incremental sync.** Every run reprocesses every bill; Zoho's `last_modified_time` is
   not stored.
3. **No 429 handling or backoff** for Zoho.
4. **No Bill → PurchaseOrder link.** `Bill` has no `purchaseOrderId`, so a bill converted
   from a PO can't be traced back to it.
5. **The Zoho vendor import creates but doesn't link.** A name match is skipped rather than
   having its `zohoVendorId` filled in, so vendors added by CSV stay unlinked.
6. **`place_of_contact` is not sent** on Zoho contacts — the accepted values aren't
   documented and couldn't be tested.
7. **Failed sync records aren't persisted** for retry; failures only reach `console.warn`.
8. **Money columns are `INT4`** (see §4).

---

## 12. Reference documents

| File | Contents |
|---|---|
| `docs/PRD.md` | Product requirements, user stories, architecture diagrams |
| `docs/SETUP_NEW_DATABASE.md` | Step-by-step: empty database → working login |
| `docs/ZOHO_WEBHOOK_SETUP.md` | Zoho credentials (Part A) and real-time webhook (Parts B–E), with the per-endpoint scope table |
| `DEPLOY.md` | Vercel deployment runbook and environment variables |
