import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../env.js";
import { pool } from "../db.js";
import { writeAudit } from "../audit.js";
import { hashPassword, verifyPassword } from "./password.js";
import { isLocked, lockUntilFromNow } from "./lockout.js";
import {
  createSession,
  destroySession,
  userFromSessionToken,
  type AuthUser,
} from "./session.js";

/** Cached dummy hash so missing-email logins take similar time (no enumeration). */
let dummyHash: string | null = null;
async function dummyPasswordHash(): Promise<string> {
  if (!dummyHash) dummyHash = await hashPassword("not-a-real-user");
  return dummyHash;
}

const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
});

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

function readSessionToken(request: FastifyRequest): string | undefined {
  const cookie = request.cookies[env.cookieName];
  if (cookie) return cookie;
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim() || undefined;
  return undefined;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await userFromSessionToken(readSessionToken(request));
  if (!user) {
    await reply.code(401).send({ error: "unauthorized" });
    return null;
  }
  request.authUser = user;
  return user;
}

function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(env.cookieName, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    expires: expiresAt,
  });
}

function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.cookieName, { path: "/" });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/auth/bootstrap-owner", async (request, reply) => {
    // Production: only allow when BOOTSTRAP_SECRET matches (or already bootstrapped → 409).
    if (process.env.NODE_ENV === "production") {
      const expected = process.env.BOOTSTRAP_SECRET ?? "";
      const got = String(request.headers["x-bootstrap-secret"] ?? "");
      if (!expected || got !== expected) {
        return reply.code(403).send({ error: "bootstrap_disabled" });
      }
    }

    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }

    const existing = await pool.query(`SELECT 1 FROM users WHERE role = 'owner' LIMIT 1`);
    if ((existing.rowCount ?? 0) > 0) {
      return reply.code(409).send({ error: "owner_exists" });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const id = randomUUID();
    const passwordHash = await hashPassword(parsed.data.password);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, 'owner')`,
      [id, email, passwordHash],
    );
    await writeAudit(pool, {
      actorUserId: id,
      kind: "auth.bootstrap_owner",
      entityId: id,
      detail: email,
    });

    const session = await createSession(id);
    setSessionCookie(reply, session.token, session.expiresAt);
    // token also in body: nginx /pra-api/ strips cookies; desk uses Bearer.
    return reply.code(201).send({ id, email, role: "owner" as const, token: session.token });
  });

  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const parsed = credentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }

      const email = parsed.data.email.trim().toLowerCase();
      const result = await pool.query<{
        id: string;
        email: string;
        role: "owner" | "staff";
        password_hash: string;
        failed_logins: number;
        locked_until: Date | null;
        disabled: boolean;
      }>(
        `SELECT id, email, role, password_hash, failed_logins, locked_until,
                COALESCE(disabled, false) AS disabled
         FROM users WHERE email = $1`,
        [email],
      );
      const user = result.rows[0];
      if (!user) {
        await verifyPassword(await dummyPasswordHash(), parsed.data.password);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      if (user.disabled) {
        await verifyPassword(user.password_hash, parsed.data.password);
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      if (isLocked(user.locked_until)) {
        return reply.code(423).send({ error: "locked" });
      }

      const ok = await verifyPassword(user.password_hash, parsed.data.password);
      if (!ok) {
        const fails = user.failed_logins + 1;
        if (fails >= env.loginMaxFailures) {
          const until = lockUntilFromNow();
          await pool.query(
            `UPDATE users SET failed_logins = $2, locked_until = $3, updated_at = now() WHERE id = $1`,
            [user.id, fails, until.toISOString()],
          );
          return reply.code(423).send({ error: "locked" });
        }
        await pool.query(
          `UPDATE users SET failed_logins = $2, updated_at = now() WHERE id = $1`,
          [user.id, fails],
        );
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      await pool.query(
        `UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1`,
        [user.id],
      );
      const session = await createSession(user.id);
      setSessionCookie(reply, session.token, session.expiresAt);
      await writeAudit(pool, {
        actorUserId: user.id,
        kind: "auth.login",
        entityId: user.id,
      });
      // token also in body: nginx /pra-api/ strips cookies; desk uses Bearer.
      return { id: user.id, email: user.email, role: user.role, token: session.token };
    },
  );

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = readSessionToken(request);
    if (token) await destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const user = await requireAuth(request, reply);
    if (!user) return;
    return { id: user.id, email: user.email, role: user.role };
  });
}
