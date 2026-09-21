import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { assertClientAccess } from "../access.js";
import { writeAudit } from "../audit.js";
import {
  enqueuePost,
  getQueueByClientUsin,
  getQueueRow,
  ownerStatusSummary,
  reconcileUnknown,
} from "./queue.js";
import { tickWorker } from "./worker.js";

const enqueueSchema = z.object({
  clientId: z.string().min(1),
  invoiceId: z.string().min(1),
  usin: z.string().min(1),
  environment: z.enum(["sandbox", "production"]),
  posId: z.string().default(""),
  payload: z.record(z.unknown()),
  confirmProduction: z.boolean().optional(),
});

const reconcileSchema = z.object({
  decision: z.enum(["posted", "not_posted"]),
  fiscalNumber: z.string().optional(),
});

const modeSchema = z.object({
  postingMode: z.enum(["browser", "server"]),
});

function publicRow(row: Awaited<ReturnType<typeof getQueueRow>>) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    invoiceId: row.invoice_id,
    usin: row.usin,
    environment: row.environment,
    posId: row.pos_id,
    status: row.status,
    attemptCount: row.attempt_count,
    fiscalNumber: row.fiscal_number,
    lastCode: row.last_code,
    lastError: row.last_error,
    // Never return last_response raw in list? User asked audit stores raw; desk needs lastError.
    // Omit raw response from API to keep payloads small; include code/error only.
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    postedAt: row.posted_at?.toISOString() ?? null,
  };
}

export async function registerPostingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/post/enqueue", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const parsed = enqueueSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    if (!(await assertClientAccess(pool, user, parsed.data.clientId))) {
      return reply.code(403).send({ error: "no_access" });
    }

    const result = await enqueuePost({
      ...parsed.data,
      actorUserId: user.id,
    });
    if (!result.ok) {
      const code =
        result.reason === "production_needs_confirm"
          ? 400
          : result.reason === "mode_browser" || result.reason === "no_client"
            ? 409
            : 409;
      return reply.code(code).send({
        error: result.reason,
        job: publicRow(result.row ?? null),
      });
    }

    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "post.enqueue",
      detail: JSON.stringify({
        queueId: result.row.id,
        clientId: result.row.client_id,
        usin: result.row.usin,
        environment: result.row.environment,
        payloadHash: result.row.payload_hash,
      }),
    });

    // Nudge worker without waiting for poll interval
    void tickWorker().catch(() => undefined);

    return { ok: true, created: result.created, job: publicRow(result.row) };
  });

  app.get("/v1/post/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const row = await getQueueRow(id);
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (!(await assertClientAccess(pool, user, row.client_id))) {
      return reply.code(403).send({ error: "no_access" });
    }
    return { job: publicRow(row) };
  });

  app.get("/v1/post/by-usin", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const q = request.query as { clientId?: string; usin?: string };
    if (!q.clientId || !q.usin) return reply.code(400).send({ error: "invalid_query" });
    if (!(await assertClientAccess(pool, user, q.clientId))) {
      return reply.code(403).send({ error: "no_access" });
    }
    const row = await getQueueByClientUsin(q.clientId, q.usin);
    return { job: publicRow(row) };
  });

  app.post("/v1/post/:id/reconcile", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const id = (request.params as { id: string }).id;
    const parsed = reconcileSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const existing = await getQueueRow(id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (!(await assertClientAccess(pool, user, existing.client_id))) {
      return reply.code(403).send({ error: "no_access" });
    }
    try {
      const row = await reconcileUnknown({
        id,
        actorUserId: user.id,
        decision: parsed.data.decision,
        fiscalNumber: parsed.data.fiscalNumber,
      });
      await writeAudit(pool, {
        actorUserId: user.id,
        kind: "post.reconcile",
        detail: JSON.stringify({
          queueId: id,
          decision: parsed.data.decision,
          // never log fiscal? fiscal is public business data — OK
          fiscalNumber: parsed.data.fiscalNumber ?? "",
        }),
      });
      return { ok: true, job: publicRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message === "fiscal_number_required") {
        return reply.code(400).send({ error: "fiscal_number_required" });
      }
      throw error;
    }
  });

  app.patch("/v1/clients/:id/posting-mode", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const id = (request.params as { id: string }).id;
    const parsed = modeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const result = await pool.query(
      `UPDATE clients SET posting_mode = $2, updated_at = EXTRACT(EPOCH FROM now())::bigint * 1000
       WHERE id = $1 RETURNING id, posting_mode`,
      [id, parsed.data.postingMode],
    );
    if (!(result.rowCount ?? 0)) return reply.code(404).send({ error: "not_found" });
    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "client.posting_mode",
      detail: JSON.stringify({ clientId: id, postingMode: parsed.data.postingMode }),
    });
    return {
      ok: true,
      clientId: id,
      postingMode: result.rows[0].posting_mode,
    };
  });

  app.get("/v1/status", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const summary = await ownerStatusSummary();
    return summary;
  });
}
