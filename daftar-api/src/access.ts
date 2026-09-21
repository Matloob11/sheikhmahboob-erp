import type { Pool, PoolClient } from "pg";
import type { AuthUser } from "./auth/session.js";

type Queryable = Pool | PoolClient;

/** Owner sees all clients; staff/business only assigned ones (business = exactly one). */
export async function assertClientAccess(
  client: Queryable,
  user: AuthUser,
  clientId: string,
): Promise<boolean> {
  if (user.role === "owner") return true;
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
  const ids = result.rows.map((r) => r.client_id);
  // Business login is scoped to one client file even if rows were mis-assigned.
  if (user.role === "business") return ids.slice(0, 1);
  return ids;
}
