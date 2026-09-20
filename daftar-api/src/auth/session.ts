import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "../db.js";
import { env } from "../env.js";

export type UserRole = "owner" | "staff";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + env.sessionDays * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), userId, hashToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function userFromSessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const result = await pool.query<{
    id: string;
    email: string;
    role: UserRole;
  }>(
    `SELECT u.id, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}
