/**
 * Newest-wins merge for M2 sync.
 * - Prefer higher updatedAt.
 * - Never downgrade a posted invoice to a non-posted status.
 * - Never blank a non-empty posToken with an empty incoming value.
 */

export type InvoiceLike = {
  status?: string;
  updatedAt?: number;
  [key: string]: unknown;
};

export type ClientLike = {
  posToken?: string;
  updatedAt?: number;
  [key: string]: unknown;
};

export type MergeDecision =
  | { action: "keep_local"; reason: string }
  | { action: "take_remote"; reason: string; merged: Record<string, unknown> }
  | { action: "conflict"; reason: string; merged: Record<string, unknown> };

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function isPostedStatus(status: unknown): boolean {
  return status === "posted";
}

/** Merge one client row. Remote wins on newer updatedAt, but never wipe token. */
export function mergeClient(local: ClientLike, remote: ClientLike): MergeDecision {
  const localAt = num(local.updatedAt);
  const remoteAt = num(remote.updatedAt);
  if (remoteAt < localAt) {
    return { action: "keep_local", reason: "local_newer" };
  }
  const merged = { ...local, ...remote } as ClientLike;
  const localToken = typeof local.posToken === "string" ? local.posToken : "";
  const remoteToken = typeof remote.posToken === "string" ? remote.posToken : "";
  if (remoteToken === "" && localToken !== "") {
    merged.posToken = localToken;
  }
  if (remoteAt === localAt && JSON.stringify(local) !== JSON.stringify(merged)) {
    return { action: "conflict", reason: "same_clock_divergence", merged };
  }
  return { action: "take_remote", reason: "remote_newer_or_equal", merged };
}

/** Merge one invoice. Never replace posted with non-posted. */
export function mergeInvoice(local: InvoiceLike, remote: InvoiceLike): MergeDecision {
  const localAt = num(local.updatedAt);
  const remoteAt = num(remote.updatedAt);
  if (isPostedStatus(local.status) && !isPostedStatus(remote.status)) {
    return { action: "keep_local", reason: "never_downgrade_posted" };
  }
  if (remoteAt < localAt) {
    return { action: "keep_local", reason: "local_newer" };
  }
  const merged = { ...local, ...remote };
  if (isPostedStatus(local.status) && isPostedStatus(remote.status) && remoteAt === localAt) {
    if (JSON.stringify(local) !== JSON.stringify(remote)) {
      return { action: "conflict", reason: "posted_same_clock", merged };
    }
  }
  return { action: "take_remote", reason: "remote_newer_or_equal", merged };
}
