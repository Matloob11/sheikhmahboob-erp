import type { Pool, PoolClient } from "pg";
import type { AuthUser } from "./auth/session.js";

type Queryable = Pool | PoolClient;

/** Owner sees all clients; staff only assigned ones. */
export async function assertClientAccess(
  client: Queryable,
  user: AuthUser,
  clientId: string,
): Promise<boolean> {
  if (user.role === "owner") {
    const row = await client.query(`SELECT 1 FROM clients WHERE id = $1`, [clientId]);
    return (row.rowCount ?? 0) > 0;
  }
  const row = await client.query(
    `SELECT 1 FROM client_staff WHERE client_id = $1 AND user_id = $2`,
    [clientId, user.id],
  );
  return (row.rowCount ?? 0) > 0;
}

export async function accessibleClientIds(
  client: Queryable,
  user: AuthUser,
): Promise<string[] | "all"> {
  if (user.role === "owner") return "all";
  const result = await client.query<{ client_id: string }>(
    `SELECT client_id FROM client_staff WHERE user_id = $1`,
    [user.id],
  );
  return result.rows.map((r) => r.client_id);
}
