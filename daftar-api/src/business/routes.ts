import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { writeAudit } from "../audit.js";
import { assertClientAccess } from "../access.js";
import { hashPassword } from "../auth/password.js";
import { destroySessionsForUser } from "../auth/session.js";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  clientId: z.string().min(1),
});

const resetSchema = z.object({
  password: z.string().min(8).max(200),
});

const disableSchema = z.object({
  disabled: z.boolean(),
});

export async function registerBusinessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/business", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });

    const rows = await pool.query<{
      id: string;
      email: string;
      role: string;
      disabled: boolean;
      created_at: Date;
      client_id: string | null;
    }>(
      `SELECT u.id, u.email, u.role, COALESCE(u.disabled, false) AS disabled, u.created_at,
              cs.client_id
       FROM users u
       LEFT JOIN client_staff cs ON cs.user_id = u.id
       WHERE u.role = 'business'
       ORDER BY u.email`,
    );
    return {
      business: rows.rows.map((r) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        disabled: r.disabled,
        clientId: r.client_id ?? "",
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  });

  app.post("/v1/business", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const email = parsed.data.email.trim().toLowerCase();
    const clientId = parsed.data.clientId;
    if (!(await assertClientAccess(pool, user, clientId))) {
      return reply.code(404).send({ error: "not_found" });
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'business')`,
          [id, email, passwordHash],
        );
        await client.query(`INSERT INTO client_staff (client_id, user_id) VALUES ($1, $2)`, [
          clientId,
          id,
        ]);
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "email_exists" });
      }
      throw error;
    }

    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "business.created",
      entityId: id,
      detail: JSON.stringify({ email, clientId }),
    });
    return reply.code(201).send({
      id,
      email,
      role: "business" as const,
      disabled: false,
      clientId,
    });
  });

  app.post("/v1/business/:id/reset-password", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const id = (request.params as { id: string }).id;
    const parsed = resetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const passwordHash = await hashPassword(parsed.data.password);
    const result = await pool.query(
      `UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1 AND role = 'business' RETURNING id, email`,
      [id, passwordHash],
    );
    if (!(result.rowCount ?? 0)) return reply.code(404).send({ error: "not_found" });
    await destroySessionsForUser(id);
    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "business.password_reset",
      entityId: id,
      detail: String(result.rows[0].email),
    });
    return { ok: true };
  });

  app.patch("/v1/business/:id", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const id = (request.params as { id: string }).id;
    const parsed = disableSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const result = await pool.query(
      `UPDATE users SET disabled = $2, updated_at = now()
       WHERE id = $1 AND role = 'business' RETURNING id, email, disabled`,
      [id, parsed.data.disabled],
    );
    if (!(result.rowCount ?? 0)) return reply.code(404).send({ error: "not_found" });
    if (parsed.data.disabled) await destroySessionsForUser(id);
    await writeAudit(pool, {
      actorUserId: user.id,
      kind: parsed.data.disabled ? "business.disabled" : "business.enabled",
      entityId: id,
      detail: String(result.rows[0].email),
    });
    return {
      ok: true,
      id,
      email: result.rows[0].email,
      disabled: result.rows[0].disabled === true,
    };
  });
}
