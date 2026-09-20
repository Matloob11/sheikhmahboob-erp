import { pool } from "./db.js";

export async function registerHealthRoutes(
  app: import("fastify").FastifyInstance,
): Promise<void> {
  app.get("/v1/health", async (_request, reply) => {
    try {
      await pool.query("SELECT 1");
      return { ok: true, db: true };
    } catch {
      return reply.code(503).send({ ok: false, db: false });
    }
  });
}
