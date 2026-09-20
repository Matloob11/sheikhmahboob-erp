import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./env.js";
import { pool } from "./db.js";
import { registerHealthRoutes } from "./health.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerImportRoutes } from "./import/routes.js";
import { registerStaffRoutes } from "./staff/routes.js";
import { registerSyncRoutes } from "./sync/routes.js";

export async function buildApp(options?: { logger?: boolean }) {
  const app = Fastify({
    logger: options?.logger ?? true,
    bodyLimit: env.bodyLimitBytes,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: env.corsOrigin,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: false,
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerImportRoutes(app);
  await registerStaffRoutes(app);
  await registerSyncRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ host: env.host, port: env.port });
  console.log(`daftar-api listening on http://${env.host}:${env.port}/v1`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
}
