import { pool } from "../db.js";
import { env } from "../env.js";
import { peekPosTokenPlain } from "../crypto/posToken.js";
import { interpretPraPost, isProvenUnreachableError } from "./interpret.js";
import { sendToPra } from "./praClient.js";
import {
  claimNextPending,
  finalizeQueueRow,
  recoverCrashedSends,
  writeAttempt,
  type PostQueueRow,
} from "./queue.js";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function loadToken(clientId: string): Promise<string> {
  const result = await pool.query<{ pos_token: string }>(
    `SELECT pos_token FROM clients WHERE id = $1`,
    [clientId],
  );
  const stored = String(result.rows[0]?.pos_token ?? "");
  return peekPosTokenPlain(stored, env.tokenEncryptionKey);
}

async function processOne(row: PostQueueRow): Promise<void> {
  const token = await loadToken(row.client_id);
  if (!token) {
    await finalizeQueueRow({
      id: row.id,
      status: "failed",
      lastError: "No POS token on server for this client.",
      lastCode: "",
      lastResponse: "",
    });
    await writeAttempt({
      queueId: row.id,
      clientId: row.client_id,
      usin: row.usin,
      actorUserId: row.actor_user_id,
      environment: row.environment,
      posId: row.pos_id,
      payloadHash: row.payload_hash,
      httpStatus: null,
      praCode: "",
      rawResponse: "",
      outcome: "failed",
      errorText: "missing_token",
    });
    return;
  }

  const body =
    typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);

  try {
    const response = await sendToPra({
      environment: row.environment,
      token,
      body,
    });
    const result = interpretPraPost(response.raw, response.status);

    let status: "posted" | "failed" | "unknown";
    if (result.ok) status = "posted";
    else if (result.kind === "unknown" || result.alreadyExists) status = "unknown";
    else status = "failed";

    await finalizeQueueRow({
      id: row.id,
      status,
      fiscalNumber: result.fiscalNumber,
      lastCode: result.code,
      lastError: result.ok ? "" : result.message,
      lastResponse: result.raw.slice(0, 32_000),
    });
    await writeAttempt({
      queueId: row.id,
      clientId: row.client_id,
      usin: row.usin,
      actorUserId: row.actor_user_id,
      environment: row.environment,
      posId: row.pos_id,
      payloadHash: row.payload_hash,
      httpStatus: response.status,
      praCode: result.code,
      rawResponse: result.raw,
      outcome: status,
      errorText: result.ok ? "" : result.message,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SIMULATED_WORKER_CRASH") {
      // Leave status=sending so recoverCrashedSends can move it to unknown.
      throw error;
    }
    if (isProvenUnreachableError(error)) {
      // Never reached PRA — return to pending for automatic retry.
      await finalizeQueueRow({
        id: row.id,
        status: "pending",
        lastError: "Connection to PRA failed (unreachable). Will retry.",
        lastCode: "",
        lastResponse: "",
      });
      await writeAttempt({
        queueId: row.id,
        clientId: row.client_id,
        usin: row.usin,
        actorUserId: row.actor_user_id,
        environment: row.environment,
        posId: row.pos_id,
        payloadHash: row.payload_hash,
        httpStatus: null,
        praCode: "",
        rawResponse: "",
        outcome: "retry_pending",
        errorText: error instanceof Error ? error.message : "unreachable",
      });
      return;
    }
    // Timeout / abort / other → unknown
    const message = error instanceof Error ? error.message : "Post failed";
    await finalizeQueueRow({
      id: row.id,
      status: "unknown",
      lastError: `${message}. Check IRIS before posting again.`,
      lastCode: "",
      lastResponse: "",
    });
    await writeAttempt({
      queueId: row.id,
      clientId: row.client_id,
      usin: row.usin,
      actorUserId: row.actor_user_id,
      environment: row.environment,
      posId: row.pos_id,
      payloadHash: row.payload_hash,
      httpStatus: null,
      praCode: "",
      rawResponse: "",
      outcome: "unknown",
      errorText: message,
    });
  }
}

export async function tickWorker(): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const row = await claimNextPending(env.praClientGapMs);
    if (!row) return false;
    try {
      await processOne(row);
    } catch (error) {
      if (!(error instanceof Error && error.message === "SIMULATED_WORKER_CRASH")) {
        throw error;
      }
      // Row stays "sending" until recoverCrashedSends (restart simulation).
    }
    return true;
  } finally {
    running = false;
  }
}

export async function startPostWorker(): Promise<void> {
  const recovered = await recoverCrashedSends();
  if (recovered) {
    console.log(`post_worker recovered_sending=${recovered}`);
  }
  if (timer) return;
  timer = setInterval(() => {
    void tickWorker().catch((error) => {
      console.error("post_worker_tick_error", error instanceof Error ? error.message : error);
    });
  }, env.praWorkerPollMs);
  // Kick once
  void tickWorker().catch(() => undefined);
}

export function stopPostWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Wait until no tick is in flight (enqueue route may have nudged the worker). */
export async function awaitWorkerIdle(timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (running) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("post worker idle timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Test helper: process until idle or max ticks. */
export async function drainWorkerForTests(max = 20): Promise<number> {
  await awaitWorkerIdle();
  let n = 0;
  for (let i = 0; i < max; i += 1) {
    const did = await tickWorker();
    if (!did) break;
    n += 1;
  }
  await awaitWorkerIdle();
  return n;
}
