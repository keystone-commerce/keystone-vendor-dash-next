/**
 * Create (or promote) an ADMIN user — for bootstrapping a fresh database.
 *
 * The dashboard has no sign-up: team members are added from the in-app Team screen,
 * which itself requires an admin. On a brand new database that's a chicken-and-egg,
 * so this script creates the first one.
 *
 * Unlike `prisma/seed.ts` this writes NOTHING else — no demo vendor, catalogue or
 * bill — so it's safe to run against production.
 *
 * Usage:
 *   npx ts-node prisma/create-admin.ts <email> [name]
 *   ADMIN_EMAIL=me@company.com npx ts-node prisma/create-admin.ts
 *
 * Sign-in is passwordless: the user requests a one-time code by email, so no
 * password is set here (an unusable random hash is stored, matching what the Team
 * screen does). Re-running for an existing email promotes them to ADMIN instead of
 * failing, which is handy if someone was created with the wrong role.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

/**
 * Load .env ourselves. PrismaClient does NOT read it in a plain script (only the
 * Prisma CLI does), so without this DATABASE_URL is undefined and the script quietly
 * talks to the wrong database — or none at all. An already-set DATABASE_URL wins, so
 * you can target another database for one run:
 *   DATABASE_URL="postgresql://..." npx ts-node prisma/create-admin.ts you@co.com
 */
function loadEnvFile() {
  if (process.env.DATABASE_URL) return; // explicit override — respect it
  try {
    const raw = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (process.env[key]) continue;
      process.env[key] = rawVal.trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env — rely on real environment variables */
  }
}
loadEnvFile();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (no .env found and none in the environment).");
  process.exit(1);
}

const prisma = new PrismaClient();

/** Host + database from the URL, credentials stripped — so you can see the target. */
function describeTarget(): string {
  try {
    const u = new URL(process.env.DATABASE_URL as string);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function main() {
  const email = (process.argv[2] ?? process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.argv[3] ?? process.env.ADMIN_NAME ?? "").trim();

  // Always state the target before writing. Pointing at the wrong database is the
  // easiest mistake here, and an admin created in the wrong place is invisible.
  console.log(`→ Target database: ${describeTarget()}`);

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(
      "Usage: npx ts-node prisma/create-admin.ts <email> [name]\n" +
        "   or: ADMIN_EMAIL=you@company.com npx ts-node prisma/create-admin.ts",
    );
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    if (existing.role === "ADMIN") {
      console.log(`✓ ${email} already exists and is an ADMIN — nothing to do.`);
      return;
    }
    const updated = await prisma.user.update({
      where: { email },
      data: { role: "ADMIN" },
    });
    console.log(`✓ Promoted ${updated.email} from ${existing.role} to ADMIN.`);
    return;
  }

  // Passwordless sign-in: store an unusable random hash, same as the Team screen.
  const passwordHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
  const created = await prisma.user.create({
    data: {
      email,
      name: name || email.split("@")[0],
      role: "ADMIN",
      passwordHash,
    },
  });

  console.log(`✓ Created ADMIN ${created.email} (${created.name}).`);
  console.log("  Sign in at the app with this email — it emails a one-time code.");
  console.log("  Make sure GMAIL_OAUTH_* is configured, or the code can't be sent.");
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // The most likely first-run mistake: pointed at a fresh database that hasn't had
    // the migrations applied, where "table does not exist" isn't an obvious signal.
    if (/does not exist in the current database|relation .* does not exist/i.test(msg)) {
      console.error(
        "The `users` table doesn't exist — this database hasn't been set up yet.\n" +
          "Run the migrations first:\n\n" +
          "  npx prisma migrate deploy\n",
      );
    } else {
      console.error("Failed:", msg.split("\n").filter(Boolean).slice(0, 4).join("\n"));
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
