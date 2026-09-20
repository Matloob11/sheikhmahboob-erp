import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db.js";

export async function writeAudit(
  client: PoolClient | typeof pool,
  input: {
    actorUserId: string;
    kind: string;
    entityId?: string;
    detail?: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (id, actor_user_id, kind, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), input.actorUserId, input.kind, input.entityId ?? null, input.detail ?? ""],
  );
}
