import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool, withTransaction } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { writeAudit } from "../audit.js";
import { accessibleClientIds, assertClientAccess } from "../access.js";
import { mergeClient, mergeInvoice } from "./merge.js";
import { mapRows } from "./mapRow.js";
import { deskBackupSchema, importDeskBackup } from "../import/deskBackup.js";
import { env } from "../env.js";
import { peekPosTokenPlain } from "../crypto/posToken.js";

const pullSchema = z.object({
  sinceMs: z.coerce.number().int().nonnegative().default(0),
});

const pushSchema = z.object({
  clients: z.array(z.record(z.unknown())).default([]),
  invoices: z.array(z.record(z.unknown())).default([]),
  purchases: z.array(z.record(z.unknown())).default([]),
  returns: z.array(z.record(z.unknown())).default([]),
  psids: z.array(z.record(z.unknown())).default([]),
  buyers: z.array(z.record(z.unknown())).default([]),
  items: z.array(z.record(z.unknown())).default([]),
});

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

async function scopedQuery(
  scope: string[] | "all",
  since: number,
  allSql: string,
  scopedSql: string,
) {
  if (scope === "all") return pool.query(allSql, [since]);
  if (scope.length === 0) return { rows: [] as Record<string, unknown>[] };
  return pool.query(scopedSql, [since, scope]);
}

export async function registerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/sync/pull", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const parsed = pullSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const since = parsed.data.sinceMs;
    const scope = await accessibleClientIds(pool, user);

    const clients = await scopedQuery(
      scope,
      since,
      `SELECT * FROM clients WHERE updated_at >= $1`,
      `SELECT * FROM clients WHERE updated_at >= $1 AND id = ANY($2::text[])`,
    );
    const invoices = await scopedQuery(
      scope,
      since,
      `SELECT * FROM invoices WHERE updated_at >= $1`,
      `SELECT * FROM invoices WHERE updated_at >= $1 AND client_id = ANY($2::text[])`,
    );
    const buyers = await scopedQuery(
      scope,
      since,
      `SELECT * FROM buyers WHERE updated_at >= $1`,
      `SELECT * FROM buyers WHERE updated_at >= $1 AND client_id = ANY($2::text[])`,
    );
    const items = await scopedQuery(
      scope,
      since,
      `SELECT * FROM catalog_items WHERE updated_at >= $1`,
      `SELECT * FROM catalog_items WHERE updated_at >= $1 AND client_id = ANY($2::text[])`,
    );
    const purchases = await scopedQuery(
      scope,
      since,
      `SELECT * FROM purchases WHERE created_at >= $1 OR COALESCE(updated_at, 0) >= $1`,
      `SELECT * FROM purchases WHERE (created_at >= $1 OR COALESCE(updated_at, 0) >= $1) AND client_id = ANY($2::text[])`,
    );
    const returns = await scopedQuery(
      scope,
      since,
      `SELECT * FROM returns WHERE updated_at >= $1`,
      `SELECT * FROM returns WHERE updated_at >= $1 AND client_id = ANY($2::text[])`,
    );
    const psids = await scopedQuery(
      scope,
      since,
      `SELECT * FROM psids WHERE updated_at >= $1`,
      `SELECT * FROM psids WHERE updated_at >= $1 AND client_id = ANY($2::text[])`,
    );

    return {
      sinceMs: since,
      serverTimeMs: Date.now(),
      clients: mapRows(clients.rows as Record<string, unknown>[]),
      invoices: mapRows(invoices.rows as Record<string, unknown>[]),
      buyers: mapRows(buyers.rows as Record<string, unknown>[]),
      items: mapRows(items.rows as Record<string, unknown>[]),
      purchases: mapRows(purchases.rows as Record<string, unknown>[]),
      returns: mapRows(returns.rows as Record<string, unknown>[]),
      psids: mapRows(psids.rows as Record<string, unknown>[]),
    };
  });

  app.post("/v1/sync/push", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const parsed = pushSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const conflicts: Array<{ entity: string; id: string; reason: string }> = [];
    const skipClient = new Set<string>();
    const skipInvoice = new Set<string>();

    const result = await withTransaction(async (client) => {
      for (const raw of parsed.data.clients) {
        const id = str(raw.id);
        if (!id) continue;
        const existing = await client.query(`SELECT * FROM clients WHERE id = $1`, [id]);
        if (!(existing.rowCount ?? 0)) {
          if (user.role !== "owner") {
            conflicts.push({ entity: "client", id, reason: "staff_cannot_create" });
            skipClient.add(id);
          }
          continue;
        }
        if (!(await assertClientAccess(client, user, id))) {
          conflicts.push({ entity: "client", id, reason: "no_access" });
          skipClient.add(id);
          continue;
        }
        const decision = mergeClient(
          {
            posToken: peekPosTokenPlain(String(existing.rows[0].pos_token ?? ""), env.tokenEncryptionKey),
            updatedAt: Number(existing.rows[0].updated_at),
            businessName: String(existing.rows[0].business_name ?? ""),
          },
          {
            posToken: str(raw.posToken),
            updatedAt: num(raw.updatedAt),
            businessName: str(raw.businessName),
          },
        );
        if (decision.action === "keep_local") {
          conflicts.push({ entity: "client", id, reason: decision.reason });
          skipClient.add(id);
        } else if (decision.action === "conflict") {
          conflicts.push({ entity: "client", id, reason: decision.reason });
        }
      }

      for (const raw of parsed.data.invoices) {
        const id = str(raw.id);
        const clientId = str(raw.clientId);
        if (!id || !clientId) continue;
        if (!(await assertClientAccess(client, user, clientId))) {
          conflicts.push({ entity: "invoice", id, reason: "no_access" });
          skipInvoice.add(id);
          continue;
        }
        const existing = await client.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
        if (existing.rows[0]) {
          const decision = mergeInvoice(
            {
              status: String(existing.rows[0].status ?? ""),
              updatedAt: Number(existing.rows[0].updated_at),
            },
            { status: str(raw.status), updatedAt: num(raw.updatedAt) },
          );
          if (decision.action === "keep_local") {
            conflicts.push({ entity: "invoice", id, reason: decision.reason });
            skipInvoice.add(id);
          } else if (decision.action === "conflict") {
            conflicts.push({ entity: "invoice", id, reason: decision.reason });
          }
        }
      }

      const backup = deskBackupSchema.parse({
        version: 5,
        exportedAt: Date.now(),
        clients: parsed.data.clients.filter((c) => !skipClient.has(str(c.id))),
        invoices: parsed.data.invoices.filter((inv) => !skipInvoice.has(str(inv.id))),
        purchases: parsed.data.purchases,
        returns: parsed.data.returns,
        psids: parsed.data.psids,
        buyers: parsed.data.buyers,
        items: parsed.data.items,
      });

      const counts = await importDeskBackup(client, backup, user.id);
      return (
        counts.clients +
        counts.invoices +
        counts.buyers +
        counts.items +
        counts.purchases +
        counts.returns +
        counts.psids
      );
    });

    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "sync.push",
      detail: JSON.stringify({ applied: result, conflicts: conflicts.length }),
    });

    return { ok: true, applied: result, conflicts };
  });
}
