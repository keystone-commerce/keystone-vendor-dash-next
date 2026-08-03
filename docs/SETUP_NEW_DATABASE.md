# Setting up a fresh database (AWS RDS)

Everything needed to take an empty Postgres database to a working dashboard you can
log in to. Roughly 10 minutes.

Run these from the project root, on a machine with Node 18+ and `pnpm` installed.

---

## Step 0 — Install dependencies

```bash
pnpm install
```

---

## Step 1 — Create `.env`

Copy the example and fill it in:

```bash
cp .env.example .env
```

The **database** section is what matters for setup. On RDS both URLs are the same
(RDS has no separate connection pooler, unlike Supabase):

```bash
DATABASE_URL="postgresql://dbadmin:REAL_PASSWORD@<your-db>.<id>.<region>.rds.amazonaws.com:5432/vendor_dashboard?sslmode=require&connection_limit=5"
DIRECT_URL="postgresql://dbadmin:REAL_PASSWORD@<your-db>.<id>.<region>.rds.amazonaws.com:5432/vendor_dashboard?sslmode=require"
```

| Part | Note |
|---|---|
| `REAL_PASSWORD` | The RDS `dbadmin` password, **percent-encoded** — `\|`, `)`, `[`, `*`, `]`, `?`, `@`, `#`, `/` and `%` have meaning in a URL and must be escaped (`%7C`, `%29`, …). Prisma decodes it automatically. pgAdmin and `PGPASSWORD` want the **decoded** form instead |
| Quoting | The `KEY="value"` form is the **file** format. Pasting into a host's environment-variable field, supply the value only — a stray `"` gives `the URL must start with the protocol postgresql://` |
| `?sslmode=require` | RDS requires TLS — keep it |
| `&connection_limit=5` | on `DATABASE_URL` only. Prisma otherwise opens far more per instance and exhausts RDS, which has no pooler |
| `DIRECT_URL` | **required for this setup** — `prisma migrate` fails with `P1012` without it. (Serving traffic doesn't need it; `prisma generate` and Prisma Client work without.) |

You also need these before anyone can actually log in (sign-in is passwordless — the
app emails a one-time code):

```bash
JWT_ACCESS_SECRET="..."      # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_REFRESH_SECRET="..."     # different value, same command
GMAIL_OAUTH_CLIENT_ID="..."
GMAIL_OAUTH_CLIENT_SECRET="..."
GMAIL_OAUTH_REFRESH_TOKEN="..."
GMAIL_SENDER_EMAIL="..."
```

---

## Step 2 — Generate the Prisma client

```bash
npx prisma generate
```

---

## Step 3 — Create the tables

```bash
npx prisma migrate deploy
```

Expected output ends with:

```text
11 migrations found in prisma/migrations
...
All migrations have been successfully applied.
```

> ⚠️ **It must say 11 migrations.** A lower number means older code: below 9 the
> `login_otps` table is missing and **nobody can log in**, below 10 vendor creation fails
> on the `VendorCategory` enum, and below 11 the bills rename is absent. None of these
> report themselves clearly. Pull the latest `main` and re-run.

Verify 13 tables exist (12 app tables plus `_prisma_migrations`):

```bash
npx prisma db execute --stdin <<< "SELECT count(*) FROM pg_tables WHERE schemaname='public';"
```

---

## Step 4 — Create the first admin

There is no sign-up screen: team members are added from the in-app **Team** page,
which itself requires an admin. So the first one is created here.

```bash
npx ts-node prisma/create-admin.ts YOUR@EMAIL.COM "Your Name"
```

Example:

```bash
npx ts-node prisma/create-admin.ts shlok@keystonecommerce.in "Shlok"
```

Expected:

```text
→ Target database: <your-db>.….rds.amazonaws.com:5432/<database>
✓ Created ADMIN shlok@keystonecommerce.in (Shlok).
  Sign in at the app with this email — it emails a one-time code.
```

Check that first line names the database you intended. No password is set — sign-in
is passwordless, so use a **real inbox** you can receive the code at.

Re-running with the same email is safe: it promotes an existing user to ADMIN rather
than failing. That also makes it the tool for granting admin later.

<details>
<summary>Targeting a different database for one run</summary>

An explicit `DATABASE_URL` overrides `.env`:

```bash
DATABASE_URL="postgresql://dbadmin:PASSWORD@host:5432/vendor_dashboard?sslmode=require" \
  npx ts-node prisma/create-admin.ts admin@keystonecommerce.in "Admin"
```

Note this puts the password in your shell history — prefer `.env` on a shared machine.
</details>

---

## Step 5 — Start the app and log in

```bash
pnpm run dev
```

1. Open http://localhost:3000
2. Enter the admin email from Step 4
3. Check that inbox for the 6-digit code (valid 10 minutes)
4. Enter it — you're in

Then add the rest of the team from **Team** in the header.

---

## Step 6 — Add the remaining team members

In the app: **Team → email + name + role → Add**. Roles:

| Role | Can do |
|---|---|
| **ADMIN** | Everything, including approving POs and managing the team |
| **PROCUREMENT_MEMBER** | Create vendors, upload catalogues, submit POs (cannot approve) |
| **VIEWER** | Read-only |

No passwords to distribute — each person signs in with a code emailed to them.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `P1012 Environment variable not found: DIRECT_URL` | `DIRECT_URL` missing | Add it to `.env` (same URL as `DATABASE_URL`) |
| `The users table does not exist` | Migrations not run | `npx prisma migrate deploy` |
| Fewer than **11** migrations | Code predates a needed migration | Pull latest `main`, re-run |
| `Can't reach database server` | Security group / not publicly accessible | Allow your IP on the RDS security group |
| `no pg_hba.conf entry ... SSL off` | Missing SSL | Add `?sslmode=require` |
| Admin created but no email arrives | `GMAIL_OAUTH_*` not set | Set them, restart, use **Resend code** |
| `too many connections` under load | No pooler on RDS | Lower `connection_limit`, or use **RDS Proxy** |

---

## Production notes (Vercel / AWS hosting)

- Set the same variables in the host's environment settings, then **redeploy** — env
  changes do not reach an existing deployment.
- `ZOHO_WEBHOOK_SECRET` and `CRON_SECRET` **fail silently** if missing: bill sync
  simply stops with no error anywhere in the UI.
- Keep `ZOHO_ENABLED="true"`, or the app runs in demo mode and purchase orders never
  reach Zoho Books (they get fake `PO-MOCK-…` numbers).
- After switching to a different Zoho organisation, every vendor must be re-linked
  ("Create in Zoho & link") — stored Zoho vendor ids point at the old org.
