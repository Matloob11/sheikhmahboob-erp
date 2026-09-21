import type { Pool, PoolClient } from "pg";
import { pool } from "../db.js";
import { hashPayload, newId } from "./praClient.js";

export type PostQueueStatus = "pending" | "sending" | "posted" | "failed" | "unknown";

export type PostQueueRow = {
  id: string;
  client_id: string;
  invoice_id: string;
  usin: string;
  environment: "sandbox" | "production";
  pos_id: string;
  status: PostQueueStatus;
  payload: unknown;
  payload_hash: string;
  attempt_count: number;
  fiscal_number: string;
  last_code: string;
  last_error: string;
  last_response: string;
  actor_user_id: string | null;
  claimed_at: Date | null;
  posted_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type EnqueueInput = {
  clientId: string;
  invoiceId: string;
  usin: string;
  environment: "sandbox" | "production";
  posId: string;
  payload: Record<string, unknown>;
  actorUserId: string;
  /** Required for production posts. */
  confirmProduction?: boolean;
};

export type EnqueueResult =
  | { ok: true; row: PostQueueRow; created: boolean }
  | {
      ok: false;
      reason:
        | "production_needs_confirm"
        | "already_posted"
        | "already_sending"
        | "must_reconcile_unknown"
        | "mode_browser"
        | "no_client";
      row?: PostQueueRow;
    };

function mapRow(row: Record<string, unknown>): PostQueueRow {
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    invoice_id: String(row.invoice_id),
    usin: String(row.usin),
    environment: row.environment === "production" ? "production" : "sandbox",
    pos_id: String(row.pos_id ?? ""),
    status: row.status as PostQueueStatus,
    payload: row.payload,
    payload_hash: String(row.payload_hash),
    attempt_count: Number(row.attempt_count ?? 0),
    fiscal_number: String(row.fiscal_number ?? ""),
    last_code: String(row.last_code ?? ""),
    last_error: String(row.last_error ?? ""),
    last_response: String(row.last_response ?? ""),
    actor_user_id: row.actor_user_id != null ? String(row.actor_user_id) : null,
    claimed_at: row.claimed_at ? new Date(String(row.claimed_at)) : null,
    posted_at: row.posted_at ? new Date(String(row.posted_at)) : null,
    created_at: new Date(String(row.created_at)),
    updated_at: new Date(String(row.updated_at)),
  };
}

export async function getClientPostingMode(
  client: Pool | PoolClient,
  clientId: string,
): Promise<"browser" | "server" | null> {
  const result = await client.query<{ posting_mode: string }>(
    `SELECT posting_mode FROM clients WHERE id = $1`,
    [clientId],
  );
  if (!(result.rowCount ?? 0)) return null;
  return result.rows[0].posting_mode === "server" ? "server" : "browser";
}

export async function enqueuePost(input: EnqueueInput): Promise<EnqueueResult> {
  if (input.environment === "production" && !input.confirmProduction) {
    return { ok: false, reason: "production_needs_confirm" };
  }

  return pool.connect().then(async (client) => {
    try {
      await client.query("BEGIN");
      const mode = await getClientPostingMode(client, input.clientId);
      if (mode === null) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "no_client" as const };
      }
      if (mode !== "server") {
        await client.query("ROLLBACK");
        return { ok: false, reason: "mode_browser" as const };
      }

      const existing = await client.query(`SELECT * FROM post_queue WHERE client_id = $1 AND usin = $2 FOR UPDATE`, [
        input.clientId,
        input.usin,
      ]);
      const body = JSON.stringify(input.payload);
      const payloadHash = hashPayload(body);

      if (existing.rows[0]) {
        const row = mapRow(existing.rows[0]);
        if (row.status === "posted") {
          await client.query("COMMIT");
          return { ok: false, reason: "already_posted", row };
        }
        if (row.status === "sending") {
          await client.query("COMMIT");
          return { ok: false, reason: "already_sending", row };
        }
        if (row.status === "unknown") {
          await client.query("COMMIT");
          return { ok: false, reason: "must_reconcile_unknown", row };
        }
        // failed or pending → re-queue
        const updated = await client.query(
          `UPDATE post_queue SET
            invoice_id = $1,
            environment = $2,
            pos_id = $3,
            status = 'pending',
            payload = $4::jsonb,
            payload_hash = $5,
            actor_user_id = $6,
            last_error = '',
            last_code = '',
            last_response = '',
            claimed_at = NULL,
            updated_at = now()
          WHERE id = $7
          RETURNING *`,
          [
            input.invoiceId,
            input.environment,
            input.posId,
            body,
            payloadHash,
            input.actorUserId,
            row.id,
          ],
        );
        await client.query("COMMIT");
        return { ok: true, row: mapRow(updated.rows[0]), created: false };
      }

      const id = newId("pq");
      const inserted = await client.query(
        `INSERT INTO post_queue (
          id, client_id, invoice_id, usin, environment, pos_id, status, payload, payload_hash, actor_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7::jsonb,$8,$9)
        ON CONFLICT (client_id, usin) DO NOTHING
        RETURNING *`,
        [
          id,
          input.clientId,
          input.invoiceId,
          input.usin,
          input.environment,
          input.posId,
          body,
          payloadHash,
          input.actorUserId,
        ],
      );
      if (!(inserted.rowCount ?? 0)) {
        // Race: another insert won — re-read
        const again = await client.query(`SELECT * FROM post_queue WHERE client_id = $1 AND usin = $2`, [
          input.clientId,
          input.usin,
        ]);
        await client.query("COMMIT");
        const row = mapRow(again.rows[0]);
        if (row.status === "posted") return { ok: false, reason: "already_posted", row };
        if (row.status === "sending") return { ok: false, reason: "already_sending", row };
        if (row.status === "unknown") return { ok: false, reason: "must_reconcile_unknown", row };
        return { ok: true, row, created: false };
      }
      await client.query("COMMIT");
      return { ok: true, row: mapRow(inserted.rows[0]), created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}

/** Crash recovery: any row still "sending" becomes "unknown" — never pending. */
export async function recoverCrashedSends(): Promise<number> {
  const result = await pool.query(
    `UPDATE post_queue
     SET status = 'unknown',
         last_error = 'Worker stopped mid-send. Check IRIS before posting again.',
         claimed_at = NULL,
         updated_at = now()
     WHERE status = 'sending'
     RETURNING id`,
  );
  return result.rowCount ?? 0;
}

export async function claimNextPending(minGapMs: number): Promise<PostQueueRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const picked = await client.query(
      `SELECT pq.*
       FROM post_queue pq
       WHERE pq.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM post_attempts pa
           WHERE pa.client_id = pq.client_id
             AND pa.at > now() - ($1::text || ' milliseconds')::interval
         )
       ORDER BY pq.created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [String(minGapMs)],
    );
    if (!(picked.rowCount ?? 0)) {
      await client.query("COMMIT");
      return null;
    }
    const id = String(picked.rows[0].id);
    const updated = await client.query(
      `UPDATE post_queue
       SET status = 'sending',
           claimed_at = now(),
           attempt_count = attempt_count + 1,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    await client.query("COMMIT");
    return mapRow(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeQueueRow(options: {
  id: string;
  status: "posted" | "failed" | "unknown" | "pending";
  fiscalNumber?: string;
  lastCode?: string;
  lastError?: string;
  lastResponse?: string;
}): Promise<PostQueueRow> {
  const result = await pool.query(
    `UPDATE post_queue SET
      status = $2,
      fiscal_number = CASE WHEN $2 = 'posted' THEN COALESCE($3, fiscal_number) ELSE fiscal_number END,
      last_code = COALESCE($4, last_code),
      last_error = COALESCE($5, last_error),
      last_response = COALESCE($6, last_response),
      posted_at = CASE WHEN $2 = 'posted' THEN now() ELSE posted_at END,
      claimed_at = NULL,
      updated_at = now()
    WHERE id = $1
    RETURNING *`,
    [
      options.id,
      options.status,
      options.fiscalNumber ?? null,
      options.lastCode ?? null,
      options.lastError ?? null,
      options.lastResponse ?? null,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function writeAttempt(options: {
  queueId: string;
  clientId: string;
  usin: string;
  actorUserId: string | null;
  environment: string;
  posId: string;
  payloadHash: string;
  httpStatus: number | null;
  praCode: string;
  rawResponse: string;
  outcome: string;
  errorText: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO post_attempts (
      id, queue_id, client_id, usin, actor_user_id, environment, pos_id, payload_hash,
      http_status, pra_code, raw_response, outcome, error_text
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      newId("pa"),
      options.queueId,
      options.clientId,
      options.usin,
      options.actorUserId,
      options.environment,
      options.posId,
      options.payloadHash,
      options.httpStatus,
      options.praCode,
      options.rawResponse.slice(0, 32_000),
      options.outcome,
      options.errorText.slice(0, 4_000),
    ],
  );
}

export async function getQueueRow(id: string): Promise<PostQueueRow | null> {
  const result = await pool.query(`SELECT * FROM post_queue WHERE id = $1`, [id]);
  if (!(result.rowCount ?? 0)) return null;
  return mapRow(result.rows[0]);
}

export async function getQueueByClientUsin(
  clientId: string,
  usin: string,
): Promise<PostQueueRow | null> {
  const result = await pool.query(`SELECT * FROM post_queue WHERE client_id = $1 AND usin = $2`, [
    clientId,
    usin,
  ]);
  if (!(result.rowCount ?? 0)) return null;
  return mapRow(result.rows[0]);
}

export async function reconcileUnknown(options: {
  id: string;
  actorUserId: string;
  decision: "posted" | "not_posted";
  fiscalNumber?: string;
}): Promise<PostQueueRow | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(`SELECT * FROM post_queue WHERE id = $1 FOR UPDATE`, [
      options.id,
    ]);
    if (!(existing.rowCount ?? 0)) {
      await client.query("ROLLBACK");
      return null;
    }
    const row = mapRow(existing.rows[0]);
    if (row.status !== "unknown") {
      await client.query("COMMIT");
      return row;
    }
    if (options.decision === "posted") {
      const fiscal = (options.fiscalNumber ?? "").trim();
      if (!fiscal) {
        await client.query("ROLLBACK");
        throw new Error("fiscal_number_required");
      }
      const updated = await client.query(
        `UPDATE post_queue SET
          status = 'posted',
          fiscal_number = $2,
          last_error = '',
          actor_user_id = $3,
          posted_at = now(),
          updated_at = now()
        WHERE id = $1
        RETURNING *`,
        [options.id, fiscal, options.actorUserId],
      );
      await client.query("COMMIT");
      return mapRow(updated.rows[0]);
    }
    const updated = await client.query(
      `UPDATE post_queue SET
        status = 'failed',
        last_error = 'Marked not posted after IRIS check.',
        actor_user_id = $2,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      [options.id, options.actorUserId],
    );
    await client.query("COMMIT");
    return mapRow(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ownerStatusSummary(): Promise<{
  depth: Record<PostQueueStatus, number>;
  oldestPendingAgeSec: number | null;
  lastErrorByClient: Array<{ clientId: string; businessName: string; lastError: string; at: string }>;
}> {
  const depthRows = await pool.query<{ status: PostQueueStatus; n: string }>(
    `SELECT status, count(*)::text AS n FROM post_queue GROUP BY status`,
  );
  const depth: Record<PostQueueStatus, number> = {
    pending: 0,
    sending: 0,
    posted: 0,
    failed: 0,
    unknown: 0,
  };
  for (const row of depthRows.rows) depth[row.status] = Number(row.n);

  const oldest = await pool.query<{ age_sec: string }>(
    `SELECT EXTRACT(EPOCH FROM (now() - created_at))::bigint::text AS age_sec
     FROM post_queue WHERE status = 'pending'
     ORDER BY created_at ASC LIMIT 1`,
  );
  const oldestPendingAgeSec = oldest.rows[0] ? Number(oldest.rows[0].age_sec) : null;

  const errors = await pool.query<{
    client_id: string;
    business_name: string;
    last_error: string;
    updated_at: Date;
  }>(
    `SELECT DISTINCT ON (pq.client_id)
       pq.client_id, c.business_name, pq.last_error, pq.updated_at
     FROM post_queue pq
     JOIN clients c ON c.id = pq.client_id
     WHERE pq.last_error <> ''
     ORDER BY pq.client_id, pq.updated_at DESC
     LIMIT 50`,
  );

  return {
    depth,
    oldestPendingAgeSec,
    lastErrorByClient: errors.rows.map((r) => ({
      clientId: r.client_id,
      businessName: r.business_name,
      lastError: r.last_error,
      at: new Date(r.updated_at).toISOString(),
    })),
  };
}

export { mapRow };
