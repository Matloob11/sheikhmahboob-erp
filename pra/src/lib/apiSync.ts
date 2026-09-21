/**
 * M2 desk ↔ API sync (Bearer). Newest-wins on server; conflicts surface in UI.
 * Offline: mark dirty + queue; drain when online.
 */
import { db } from "../db";
import { applyPullPayload, type SyncConflict } from "./applyPull";
import type { DeskBackup } from "./backup";

const API_URL_KEY = "daftar.apiBase";
const API_TOKEN_KEY = "daftar.apiToken";
const SYNC_SINCE_KEY = "daftar.syncSinceMs";
const SYNC_DIRTY_KEY = "daftar.syncDirty";
const SYNC_CONFLICTS_KEY = "daftar.syncConflicts";
const SYNC_QUEUE_KEY = "daftar.syncQueue";

export type SyncResult = {
  applied: number;
  pulled: number;
  conflicts: SyncConflict[];
  queued?: boolean;
};

export function apiBase(): string {
  const stored = localStorage.getItem(API_URL_KEY);
  if (stored) return stored.replace(/\/$/, "");
  if (typeof location !== "undefined" && /sheikhmahboob\.com$/i.test(location.hostname)) {
    return "https://sheikhmahboob.com/pra-api/v1";
  }
  return "http://127.0.0.1:8787/v1";
}

export function hasApiToken(): boolean {
  return Boolean(localStorage.getItem(API_TOKEN_KEY));
}

export function markSyncDirty(): void {
  localStorage.setItem(SYNC_DIRTY_KEY, "1");
  const queue = readQueue();
  queue.push({ at: Date.now(), reason: "dirty" });
  // Cap queue markers — full Dexie push is the payload, not each event.
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue.slice(-50)));
}

export function isSyncDirty(): boolean {
  return localStorage.getItem(SYNC_DIRTY_KEY) === "1";
}

export function syncQueueDepth(): number {
  return readQueue().length;
}

function readQueue(): Array<{ at: number; reason: string }> {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ at: number; reason: string }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearQueue(): void {
  localStorage.removeItem(SYNC_DIRTY_KEY);
  localStorage.removeItem(SYNC_QUEUE_KEY);
}

export function readStoredConflicts(): SyncConflict[] {
  try {
    const raw = localStorage.getItem(SYNC_CONFLICTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SyncConflict[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function storeConflicts(conflicts: SyncConflict[]): void {
  if (!conflicts.length) {
    localStorage.removeItem(SYNC_CONFLICTS_KEY);
    return;
  }
  localStorage.setItem(SYNC_CONFLICTS_KEY, JSON.stringify(conflicts.slice(0, 40)));
}

export function clearStoredConflicts(): void {
  localStorage.removeItem(SYNC_CONFLICTS_KEY);
}

export async function loginForSync(email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBase()}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(res.status === 423 ? "API account locked." : "API login failed.");
  const body = (await res.json()) as { token?: string; role?: string };
  if (!body.token) throw new Error("API login returned no token.");
  localStorage.setItem(API_TOKEN_KEY, body.token);
  if (body.role) localStorage.setItem("daftar.apiRole", body.role);
  return body.token;
}

export function apiRole(): "owner" | "staff" | null {
  const r = localStorage.getItem("daftar.apiRole");
  return r === "owner" || r === "staff" ? r : null;
}

export async function logoutApi(): Promise<void> {
  const token = localStorage.getItem(API_TOKEN_KEY);
  try {
    if (token) {
      await fetch(`${apiBase()}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        credentials: "omit",
      });
    }
  } catch {
    // Still clear local token
  }
  localStorage.removeItem(API_TOKEN_KEY);
  localStorage.removeItem("daftar.apiRole");
}

function tokenOrThrow(): string {
  const t = localStorage.getItem(API_TOKEN_KEY);
  if (!t) throw new Error("Not signed in to API. Enter email/password and sync once.");
  return t;
}

async function deskPayload() {
  return {
    clients: await db.clients.toArray(),
    invoices: await db.invoices.toArray(),
    purchases: await db.purchases.toArray(),
    returns: await db.returns.toArray(),
    psids: await db.psids.toArray(),
    buyers: await db.buyers.toArray(),
    items: await db.items.toArray(),
  };
}

export async function pushDeskNow(): Promise<{
  applied: number;
  conflicts: SyncConflict[];
}> {
  const token = tokenOrThrow();
  const payload = await deskPayload();
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
    conflicts: SyncConflict[];
  };
}

export async function pullDeskNow(): Promise<{ pulled: number; conflicts: SyncConflict[] }> {
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
  const applied = await applyPullPayload(body);
  localStorage.setItem(SYNC_SINCE_KEY, String(body.serverTimeMs));
  return applied;
}

/** Push then pull. On network failure, queue and keep desk usable. */
export async function syncNow(): Promise<SyncResult> {
  try {
    const push = await pushDeskNow();
    const pull = await pullDeskNow();
    const conflicts = [...push.conflicts, ...pull.conflicts];
    storeConflicts(conflicts);
    clearQueue();
    return { applied: push.applied, pulled: pull.pulled, conflicts };
  } catch (error) {
    markSyncDirty();
    const message = error instanceof Error ? error.message : "Sync failed";
    if (/Failed to fetch|NetworkError|Load failed|sync push failed|sync pull failed/i.test(message) || !navigator.onLine) {
      return { applied: 0, pulled: 0, conflicts: readStoredConflicts(), queued: true };
    }
    throw error;
  }
}

/** Drain dirty queue when online. No-op without token. */
export async function drainSyncQueue(): Promise<SyncResult | null> {
  if (!hasApiToken()) return null;
  if (!isSyncDirty() && syncQueueDepth() === 0) return null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return null;
  return syncNow();
}

export async function syncPushWithLogin(
  email: string,
  password: string,
): Promise<SyncResult> {
  await loginForSync(email, password);
  return syncNow();
}

export type { DeskBackup, SyncConflict };
