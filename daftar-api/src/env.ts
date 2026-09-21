import { config } from "dotenv";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisDir = dirname(fileURLToPath(import.meta.url));
// src/env.ts → package root is .. ; dist/src/env.js → package root is ../..
const root =
  basename(thisDir) === "src" && basename(dirname(thisDir)) === "dist"
    ? resolve(thisDir, "../..")
    : resolve(thisDir, "..");
config({ path: resolve(root, ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

export const env = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? "8787"),
  databaseUrl: required(
    "DATABASE_URL",
    "postgres://daftar:daftar_local_dev@127.0.0.1:5433/daftar",
  ),
  sessionDays: Number(process.env.SESSION_DAYS ?? "7"),
  cookieName: process.env.COOKIE_NAME ?? "daftar_session",
  cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://127.0.0.1:5173,http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  bodyLimitBytes: Number(process.env.BODY_LIMIT_BYTES ?? String(32 * 1024 * 1024)),
  loginMaxFailures: Number(process.env.LOGIN_MAX_FAILURES ?? "5"),
  loginLockMinutes: Number(process.env.LOGIN_LOCK_MINUTES ?? "15"),
  /** 32-byte hex (64 chars) preferred. Required in production; local falls back to a fixed test key. */
  tokenEncryptionKey: required(
    "TOKEN_ENCRYPTION_KEY",
    process.env.NODE_ENV === "production" ? undefined : "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
  /** Optional override for tests / fake PRA. Empty = real PRA hosts. */
  praPostUrlOverride: process.env.PRA_POST_URL_OVERRIDE ?? "",
  praFetchMs: Number(process.env.PRA_FETCH_MS ?? "45000"),
  praWorkerPollMs: Number(process.env.PRA_WORKER_POLL_MS ?? "2000"),
  praClientGapMs: Number(process.env.PRA_CLIENT_GAP_MS ?? "1500"),
  root,
};
