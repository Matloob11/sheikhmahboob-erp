import type { FastifyInstance } from "fastify";
import { withTransaction } from "../db.js";
import { requireAuth } from "../auth/routes.js";
import { deskBackupSchema, importDeskBackup, tableCounts } from "./deskBackup.js";

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/import/desk-backup", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;

    const parsed = deskBackupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_backup", detail: parsed.error.flatten() });
    }

    const counts = await withTransaction((client) =>
      importDeskBackup(client, parsed.data, user.id),
    );
    return { ok: true, counts };
  });

  app.get("/v1/import/summary", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    const { pool } = await import("../db.js");
    return tableCounts(pool);
  });
}
