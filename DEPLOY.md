# Deploying the Keystone Vendor Dashboard (Vercel)

This app is a Next.js 14 app that talks to **AWS RDS (Postgres)**, **Zoho Books**,
**Google Drive**, and **Gmail** (for login codes + PO emails). The code has **no secrets in
it** — everything sensitive comes from environment variables you set in Vercel.

> ⚠️ **Never commit real secret values to this repo.** Only the *keys* are documented here.
> Copy the actual values from the current deployment / a password manager into Vercel directly.

---

## 1. Import the project into Vercel
1. Vercel → **Add New → Project** → import this GitHub repo.
2. Framework preset: **Next.js** (auto-detected).
3. Build command: `prisma generate && next build` (already in `package.json`).
4. Install command: `pnpm install` (repo uses **pnpm**; a `pnpm-lock.yaml` is committed).

## 2. Set environment variables
Add these under **Settings → Environment Variables**, ticked for **Production** (and Preview if
you want PR previews to work). Values come from the current deployment / password manager.

### Database (AWS RDS Postgres)

| Key | What / where |
|---|---|
| `DATABASE_URL` | Instance endpoint, port **5432**, `?sslmode=require&connection_limit=5` |
| `DIRECT_URL` | Same URL **without** `connection_limit` (migrations only) |

```text
postgresql://USER:ENCODED_PASSWORD@<instance>.<id>.<region>.rds.amazonaws.com:5432/<database>?sslmode=require&connection_limit=5
```

Four things go wrong here more often than anything else in this document:

| | Why |
|---|---|
| **Paste only the value into Vercel** | No `DATABASE_URL=`, no quotes. Those belong in a `.env` file. A leading `"` or space gives `the URL must start with the protocol postgresql://` — the variable is read, but rejected before any connection is attempted |
| **`?sslmode=require` is mandatory** | RDS refuses plaintext connections |
| **Percent-encode the password** | `\| ) [ * ] ? @ # /` etc. must be escaped in a URL (`%7C`, `%29`, …). Prisma decodes it automatically. Tools that take a plain password — pgAdmin, `PGPASSWORD` — need the **decoded** form instead |
| **`connection_limit` on `DATABASE_URL` only** | RDS has **no built-in pooler**, unlike Supabase. Each warm serverless instance opens its own pool, so an unbounded pool exhausts `max_connections` and everything starts failing at once. Use **RDS Proxy** if you outgrow it |

> `DIRECT_URL` is **not** needed to serve traffic — `prisma generate` and Prisma Client both
> work without it. It's required by `prisma migrate` / `prisma validate`, which fail with
> `P1012` if it's unset. Set it anyway if you ever run migrations from CI.

### Auth (JWT)
| Key | What |
|---|---|
| `JWT_ACCESS_SECRET` | long random string (do NOT leave default) |
| `JWT_REFRESH_SECRET` | long random string |
| `JWT_ACCESS_TTL` | e.g. `15m` |
| `JWT_REFRESH_TTL` | e.g. `7d` |

### App
| Key | What |
|---|---|
| `APP_URL` | the production URL (optional — code auto-detects the Vercel URL if unset) |

### Zoho Books
| Key |
|---|
| `ZOHO_ENABLED` (`true`) |
| `ZOHO_CLIENT_ID` |
| `ZOHO_CLIENT_SECRET` |
| `ZOHO_REFRESH_TOKEN` |
| `ZOHO_ORGANIZATION_ID` |
| `ZOHO_DC` (`in`) |
| `ZOHO_INVOICE_SOURCE` (`bills` for procurement, or `invoices`) |

### Google Drive (catalogues)
| Key |
|---|
| `DRIVE_ENABLED` (`true`) |
| `DRIVE_CATALOGUES_FOLDER_ID` |
| `DRIVE_SERVICE_ACCOUNT_JSON` (base64-encoded service-account key) |

### Mail — Gmail OAuth (preferred; used for login codes + PO emails)
| Key |
|---|
| `GMAIL_OAUTH_CLIENT_ID` |
| `GMAIL_OAUTH_CLIENT_SECRET` |
| `GMAIL_OAUTH_REFRESH_TOKEN` (scope: `gmail.send`) |
| `GMAIL_SENDER_EMAIL` |
| `GMAIL_SENDER_NAME` (e.g. `Keystone Procurement`) |

> There is no `PO_APPROVER_EMAIL`. Approval emails go to the **ADMIN users in the
> database**, managed on the Team page — so changing who approves needs no redeploy. The
> old variable bypassed the role check and could send approval requests, with the PO PDF
> attached, to someone not allowed to approve.

All outbound mail — login codes, approval requests, the vendor's PO — goes through these
credentials. If that refresh token is revoked **nobody can sign in**, because sign-in is
passwordless.

### Auto-sync secrets

| Key | What |
|---|---|
| `ZOHO_WEBHOOK_SECRET` | Random string; goes in the Zoho workflow webhook URL as `?token=…` |
| `CRON_SECRET` | Random string; Vercel sends it on the scheduled sync (`vercel.json`, every 15 min) |

Both **fail silently** if unset — bill sync simply stops, with no error surfaced in the UI.

```bash
node -e "console.log('whk_'+require('crypto').randomBytes(24).toString('hex'))"
node -e "console.log('cron_'+require('crypto').randomBytes(24).toString('hex'))"
```

## 3. Database migrations

Vercel builds only run `prisma generate`, which never touches the database. **Migrations are
applied by hand**, from a machine that can reach RDS:

```bash
npx prisma migrate deploy
```

Use `migrate deploy`, **not** `db push` — `db push` reshapes the schema without recording
anything, which is how two migrations went missing before (`login_otps` and the
`VendorCategory` enum change) and left a database built from migrations alone broken.

> ⚠️ **Deploy the code and the schema together.** They must not diverge: a renamed table
> plus an older deployed build gives errors like `The table public.zoho_unmatched_invoices
> does not exist` on every affected query. If a PR contains a migration, apply it and
> deploy in the same sitting.

For a brand-new database, see [`docs/SETUP_NEW_DATABASE.md`](docs/SETUP_NEW_DATABASE.md) —
migrations, then `prisma/create-admin.ts` for the first admin (there is no sign-up screen).

## 4. Deployment protection
Vercel → **Settings → Deployment Protection** → set **Vercel Authentication → Disabled** so the
team can reach the app (it has its own email-code login).

## 5. Verify after deploy
- Open the production URL → login screen loads.
- Request a login code for a provisioned email → code arrives (check Vercel **Logs** for
  `[mail] sent via gmail-api …`).
- Log in as an admin → the **Team** button (top-right) lists members.

---

## How the app works (quick map)
- **Login:** passwordless — a 6-digit code emailed to provisioned users (`login_otps` table).
- **Roles:** Admin (approves POs, manages the Team page), Procurement (vendors/catalogues/POs),
  Viewer (read-only).
- **Vendors → catalogues → purchase orders → bills** is the core flow.
- **Bills** auto-sync from Zoho Books; **approved POs** are created in Zoho automatically.
  Bills are the *supplier* side (what Keystone owes). `ZOHO_INVOICE_SOURCE="invoices"`
  switches to customer invoices instead — not what procurement wants.
- **Catalogues** sync from a Google Drive folder (filename starts with the vendor name).
- Money is stored as integer **paise** in the DB.

## Local development
```bash
pnpm install
pnpm dev        # http://localhost:3000
```
Needs a local `.env` (same keys as above, but **with** `KEY="value"` quoting — that's the
file format, unlike Vercel's value-only fields).

By default this points at the **same RDS database as production**, so anything you create
locally is real. Point `DATABASE_URL` at a separate database before testing anything
destructive.

⚠️ Mail is live locally too: submitting a PO really emails the admins, and requesting a
login code really sends one. To silence it, blank `GMAIL_OAUTH_REFRESH_TOKEN` — the mailer
then logs `[dev email] to=… subject=…` to the console instead of sending.
