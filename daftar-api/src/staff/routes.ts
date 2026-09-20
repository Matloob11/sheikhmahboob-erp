import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, withTransaction } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { writeAudit } from "../audit.js";
import { accessibleClientIds, assertClientAccess } from "../access.js";
import { hashPassword } from "../auth/password.js";

const staffCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

const assignSchema = z.object({
  clientId: z.string().min(1),
  userId: z.string().min(1),
});

export async function registerStaffRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/staff", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });

    const parsed = staffCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const email = parsed.data.email.trim().toLowerCase();
    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    try {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'staff')`,
        [id, email, passwordHash],
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return reply.code(409).send({ error: "email_exists" });
      }
      throw error;
    }
    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "staff.created",
      entityId: id,
      detail: email,
    });
    return reply.code(201).send({ id, email, role: "staff" as const });
  });

  app.post("/v1/staff/assign", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const parsed = assignSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const ok = await withTransaction(async (client) => {
      const clientOk = await assertClientAccess(client, user, parsed.data.clientId);
      if (!clientOk) return false;
      const staff = await client.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'staff'`, [
        parsed.data.userId,
      ]);
      if (!(staff.rowCount ?? 0)) return false;
      await client.query(
        `INSERT INTO client_staff (client_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [parsed.data.clientId, parsed.data.userId],
      );
      return true;
    });
    if (!ok) return reply.code(404).send({ error: "not_found" });
    await writeAudit(pool, {
      actorUserId: user.id,
      kind: "staff.assigned",
      entityId: parsed.data.clientId,
      detail: parsed.data.userId,
    });
    return { ok: true };
  });

  app.get("/v1/staff/assignments", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role === "owner") {
      const rows = await pool.query(`SELECT client_id, user_id, created_at FROM client_staff`);
      return { assignments: rows.rows };
    }
    const rows = await pool.query(
      `SELECT client_id, user_id, created_at FROM client_staff WHERE user_id = $1`,
      [user.id],
    );
    return { assignments: rows.rows };
  });

  app.get("/v1/clients", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const scope = await accessibleClientIds(pool, user);
    const result =
      scope === "all"
        ? await pool.query(`SELECT * FROM clients ORDER BY business_name`)
        : scope.length === 0
          ? { rows: [] }
          : await pool.query(`SELECT * FROM clients WHERE id = ANY($1::text[]) ORDER BY business_name`, [
              scope,
            ]);
    return { clients: result.rows };
  });
}
