-- Passwordless email sign-in codes.
--
-- This table was originally created with `prisma db push` and never captured as a
-- migration, so a fresh database built with `prisma migrate deploy` came up WITHOUT
-- it — and since OTP is the only sign-in method, nobody could log in. IF NOT EXISTS
-- keeps this a no-op on databases where db push already created it.

CREATE TABLE IF NOT EXISTS "login_otps" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "codeHash"  TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts"  INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_otps_email_idx" ON "login_otps"("email");
