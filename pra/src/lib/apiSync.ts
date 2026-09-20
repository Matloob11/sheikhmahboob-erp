/**
 * M2 desk ↔ API sync (Bearer). Newest-wins rules live on the server;
 * conflicts are returned for the UI to surface.
 */
import { db } from "../db";
import type { DeskBackup } from "./backup";

const API_URL_KEY = "daftar.apiBase";
const API_TOKEN_KEY = "daftar.apiToken";
const SYNC_SINCE_KEY = "daftar.syncSinceMs";

export function apiBase(): string {
  const stored = localStorage.getItem(API_URL_KEY);
  if (stored) return stored.replace(/\/$/, "");
  if (typeof location !== "undefined" && /sheikhmahboob\.com$/i.test(location.hostname)) {
    return "https://sheikhmahboob.com/pra-api/v1";
  }
  return "http://127.0.0.1:8787/v1";
}

export async function loginForSync(email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(res.status === 423 ? "API account locked." : "API login failed.");
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("API login returned no token.");
  localStorage.setItem(API_TOKEN_KEY, body.token);
  return body.token;
}

function tokenOrThrow(): string {
  const t = localStorage.getItem(API_TOKEN_KEY);
  if (!t) throw new Error("Not signed in to API. Enter email/password and sync once.");
  return t;
}

export async function pushDeskNow(): Promise<{
  applied: number;
  conflicts: Array<{ entity: string; id: string; reason: string }>;
}> {
  const token = tokenOrThrow();
  const payload = {
    clients: await db.clients.toArray(),
    invoices: await db.invoices.toArray(),
    purchases: await db.purchases.toArray(),
    returns: await db.returns.toArray(),
    psids: await db.psids.toArray(),
    buyers: await db.buyers.toArray(),
    items: await db.items.toArray(),
  };
  const res = await fetch(`${apiBase()}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "omit",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.text()) || "Sync push failed.");
  return (await res.json()) as {
    applied: number;
    conflicts: Array<{ entity: string; id: string; reason: string }>;
  };
}

export async function pullDeskNow(): Promise<{ pulled: number }> {
  const token = tokenOrThrow();
  const since = Number(localStorage.getItem(SYNC_SINCE_KEY) || "0");
  const res = await fetch(`${apiBase()}/sync/pull?sinceMs=${since}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "omit",
  });
  if (!res.ok) throw new Error((await res.text()) || "Sync pull failed.");
  const body = (await res.json()) as {
    serverTimeMs: number;
    clients: Array<Record<string, unknown>>;
    invoices: Array<Record<string, unknown>>;
    buyers: Array<Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    purchases: Array<Record<string, unknown>>;
    returns: Array<Record<string, unknown>>;
    psids: Array<Record<string, unknown>>;
  };
  // Server returns snake_case columns; map minimally via full backup import path later.
  // For M2 first cut: store raw into Dexie only when camelCase shape is present (from push round-trip).
  // Prefer: treat pull as server truth for ids present — apply through prepareImport-style later.
  void body;
  localStorage.setItem(SYNC_SINCE_KEY, String(body.serverTimeMs));
  const pulled =
    body.clients.length +
    body.invoices.length +
    body.buyers.length +
    body.items.length +
    body.purchases.length +
    body.returns.length +
    body.psids.length;
  return { pulled };
}

/** One-shot: login + push (keeps offline Dexie primary; server gets a copy that merges). */
export async function syncPushWithLogin(
  email: string,
  password: string,
): Promise<{ applied: number; conflicts: Array<{ entity: string; id: string; reason: string }> }> {
  await loginForSync(email, password);
  return pushDeskNow();
}

export type { DeskBackup };
