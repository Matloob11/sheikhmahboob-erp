/**
 * M3 server-side PRA posting via /pra-api.
 * Offline: local outbox; UNIQUE(client_id, usin) on the server stops double send.
 */
import { apiBase, hasApiToken } from "./apiSync";
import { unknownPraResult, type PraInvoicePayload, type PraPostResult } from "./pra";
import type { Environment } from "../types";

const POST_OUTBOX_KEY = "daftar.postOutbox";

export type PostJobPublic = {
  id: string;
  clientId: string;
  invoiceId: string;
  usin: string;
  environment: Environment;
  posId: string;
  status: "pending" | "sending" | "posted" | "failed" | "unknown";
  attemptCount: number;
  fiscalNumber: string;
  lastCode: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
};

export type OwnerPostStatus = {
  apiUp: boolean;
  postgresUp: boolean;
  newestBackupAgeSec: number | null;
  newestBackupAt: string | null;
  depth: Record<"pending" | "sending" | "posted" | "failed" | "unknown", number>;
  oldestPendingAgeSec: number | null;
  lastErrorByClient: Array<{
    clientId: string;
    businessName: string;
    lastError: string;
    at: string;
  }>;
};

export type PostOutboxItem = {
  clientId: string;
  invoiceId: string;
  usin: string;
  environment: Environment;
  posId: string;
  payload: PraInvoicePayload;
  confirmProduction?: boolean;
  queuedAt: number;
};

function tokenOrThrow(): string {
  const t = localStorage.getItem("daftar.apiToken");
  if (!t) throw new Error("Not signed in to API. Open Settings → Backup and sync once.");
  return t;
}

function readOutbox(): PostOutboxItem[] {
  try {
    const raw = localStorage.getItem(POST_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PostOutboxItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOutbox(items: PostOutboxItem[]): void {
  if (!items.length) {
    localStorage.removeItem(POST_OUTBOX_KEY);
    return;
  }
  localStorage.setItem(POST_OUTBOX_KEY, JSON.stringify(items.slice(-100)));
}

export function postOutboxDepth(): number {
  return readOutbox().length;
}

export function queuePostOutbox(item: Omit<PostOutboxItem, "queuedAt">): void {
  const queue = readOutbox().filter(
    (row) => !(row.clientId === item.clientId && row.usin === item.usin),
  );
  queue.push({ ...item, queuedAt: Date.now() });
  writeOutbox(queue);
}

export function jobToPraResult(job: PostJobPublic): PraPostResult {
  if (job.status === "posted") {
    return {
      ok: true,
      fiscalNumber: job.fiscalNumber,
      code: job.lastCode || "100",
      message: "Posted",
      alreadyExists: false,
      kind: "success",
      nextAction: "",
      raw: "",
    };
  }
  if (job.status === "unknown") {
    return unknownPraResult(
      job.lastError || "PRA result is unclear. Check IRIS before posting again.",
    );
  }
  return {
    ok: false,
    fiscalNumber: "",
    code: job.lastCode,
    message: job.lastError || "PRA rejected the invoice.",
    alreadyExists: /already\s+exist/i.test(job.lastError),
    kind: "rejected",
    nextAction: "",
    raw: "",
  };
}

export async function enqueueServerPost(input: {
  clientId: string;
  invoiceId: string;
  usin: string;
  environment: Environment;
  posId: string;
  payload: PraInvoicePayload;
  confirmProduction?: boolean;
}): Promise<{ job: PostJobPublic; created: boolean }> {
  const res = await fetch(`${apiBase()}/post/enqueue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    created?: boolean;
    job?: PostJobPublic;
  };
  if (!res.ok || !body.job) {
    throw new Error(body.error ?? `Enqueue failed (HTTP ${res.status})`);
  }
  return { job: body.job, created: body.created === true };
}

export async function getPostJob(id: string): Promise<PostJobPublic | null> {
  const res = await fetch(`${apiBase()}/post/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${tokenOrThrow()}` },
    credentials: "omit",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Status poll failed (HTTP ${res.status})`);
  const body = (await res.json()) as { job?: PostJobPublic };
  return body.job ?? null;
}

export async function pollPostJob(
  id: string,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<PostJobPublic> {
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const intervalMs = options?.intervalMs ?? 400;
  const start = Date.now();
  let last: PostJobPublic | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await getPostJob(id);
    if (!last) throw new Error("Post job disappeared from the server.");
    if (last.status === "posted" || last.status === "failed" || last.status === "unknown") {
      return last;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  if (last) return last;
  throw new Error("Timed out waiting for server post status.");
}

export class OfflinePostQueuedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfflinePostQueuedError";
  }
}

/** Enqueue (or use outbox offline), then wait for a terminal server status. */
export async function submitViaServer(input: {
  clientId: string;
  invoiceId: string;
  usin: string;
  environment: Environment;
  posId: string;
  payload: PraInvoicePayload;
  confirmProduction?: boolean;
}): Promise<PraPostResult> {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (offline) {
    queuePostOutbox(input);
    throw new OfflinePostQueuedError(
      "Queued offline. Will post when the API is reachable.",
    );
  }
  if (!hasApiToken()) {
    throw new Error("Server posting needs an API sign-in (Settings → Backup).");
  }

  try {
    const { job } = await enqueueServerPost(input);
    if (job.status === "posted" || job.status === "failed" || job.status === "unknown") {
      return jobToPraResult(job);
    }
    const final = await pollPostJob(job.id);
    return jobToPraResult(final);
  } catch (error) {
    if (error instanceof OfflinePostQueuedError) throw error;
    const message = error instanceof Error ? error.message : "API unreachable";
    if (/Failed to fetch|NetworkError|ENOTFOUND|ECONNREFUSED|unreachable/i.test(message)) {
      queuePostOutbox(input);
      throw new OfflinePostQueuedError(
        "API unreachable — queued locally. Will send when the API is back.",
      );
    }
    throw error;
  }
}

/**
 * Drain local outbox: enqueue each item (server UNIQUE blocks double post),
 * return jobs that reached a terminal state for the desk to apply.
 */
export async function drainPostOutbox(): Promise<{
  sent: number;
  left: number;
  finished: Array<{ invoiceId: string; clientId: string; result: PraPostResult }>;
}> {
  if (!hasApiToken()) return { sent: 0, left: readOutbox().length, finished: [] };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: 0, left: readOutbox().length, finished: [] };
  }
  const queue = readOutbox();
  if (!queue.length) return { sent: 0, left: 0, finished: [] };
  const remaining: PostOutboxItem[] = [];
  const finished: Array<{ invoiceId: string; clientId: string; result: PraPostResult }> = [];
  let sent = 0;
  for (const item of queue) {
    try {
      const { job } = await enqueueServerPost(item);
      const terminal =
        job.status === "posted" || job.status === "failed" || job.status === "unknown"
          ? job
          : await pollPostJob(job.id, { timeoutMs: 60_000 });
      finished.push({
        invoiceId: item.invoiceId,
        clientId: item.clientId,
        result: jobToPraResult(terminal),
      });
      sent += 1;
    } catch {
      remaining.push(item);
    }
  }
  writeOutbox(remaining);
  return { sent, left: remaining.length, finished };
}

export async function fetchOwnerPostStatus(): Promise<OwnerPostStatus> {
  const res = await fetch(`${apiBase()}/status`, {
    headers: { Authorization: `Bearer ${tokenOrThrow()}` },
    credentials: "omit",
  });
  if (res.status === 403) throw new Error("Owner only.");
  if (!res.ok) throw new Error(`Status failed (HTTP ${res.status})`);
  return (await res.json()) as OwnerPostStatus;
}

export async function setClientPostingMode(
  clientId: string,
  postingMode: "browser" | "server",
): Promise<"browser" | "server"> {
  const res = await fetch(`${apiBase()}/clients/${encodeURIComponent(clientId)}/posting-mode`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenOrThrow()}`,
    },
    credentials: "omit",
    body: JSON.stringify({ postingMode }),
  });
  const body = (await res.json().catch(() => ({}))) as { postingMode?: string; error?: string };
  if (res.status === 403) throw new Error("Owner only.");
  if (!res.ok) throw new Error(body.error ?? `Mode change failed (HTTP ${res.status})`);
  return body.postingMode === "server" ? "server" : "browser";
}
