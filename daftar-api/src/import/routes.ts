import type { FastifyInstance } from "fastify";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { deskBackupSchema, importDeskBackup, tableCounts } from "./deskBackup.js";

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/import/desk-backup", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });

    const parsed = deskBackupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_backup" });
    }

    const counts = await withTransaction((client) =>
      importDeskBackup(client, parsed.data, user.id),
    );
    return { ok: true, counts };
  });

  app.get("/v1/import/summary", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    if (user.role !== "owner") return reply.code(403).send({ error: "owner_only" });
    const { pool } = await import("../db.js");
    return tableCounts(pool);
  });
}
