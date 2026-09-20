import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { createSession, hashToken, userFromSessionToken } from "../src/auth/session.js";
import { env } from "../src/env.js";

async function resetAuthTables(): Promise<void> {
  await pool.query(`DELETE FROM audit_events`);
  await pool.query(`DELETE FROM import_runs`);
  await pool.query(`DELETE FROM sessions`);
  await pool.query(`DELETE FROM users`);
}

describe("auth", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetAuthTables();
  });

  it("hashes and verifies with argon2id", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct-horse-battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });

  it("bootstraps owner once then 409", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "owner@example.com", password: "password123" },
    });
    expect(first.statusCode).toBe(201);
    const body = first.json() as { id: string; role: string };
    expect(body.role).toBe("owner");

    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "other@example.com", password: "password123" },
    });
    expect(second.statusCode).toBe(409);
  });

  it("locks after 5 failed logins", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "lock@example.com", password: "password123" },
    });

    for (let i = 0; i < 4; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "lock@example.com", password: "wrong-password" },
      });
      expect(res.statusCode).toBe(401);
    }

    const locked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "lock@example.com", password: "wrong-password" },
    });
    expect(locked.statusCode).toBe(423);

    const still = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "lock@example.com", password: "password123" },
    });
    expect(still.statusCode).toBe(423);
  });

  it("rejects expired sessions", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "sess@example.com", password: "password123" },
    });
    const { id } = created.json() as { id: string };
    const { token } = await createSession(id);
    await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute' WHERE token_hash = $1`, [
      hashToken(token),
    ]);
    expect(await userFromSessionToken(token)).toBeNull();

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      cookies: { [env.cookieName]: token },
    });
    expect(me.statusCode).toBe(401);
  });

  it("login logout me happy path", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "happy@example.com", password: "password123" },
    });

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "happy@example.com", password: "password123" },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((c) => c.name === env.cookieName);
    expect(cookie?.value).toBeTruthy();

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      cookies: { [env.cookieName]: cookie!.value },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: "happy@example.com", role: "owner" });

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      cookies: { [env.cookieName]: cookie!.value },
    });
    expect(logout.statusCode).toBe(200);

    const meAfter = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      cookies: { [env.cookieName]: cookie!.value },
    });
    expect(meAfter.statusCode).toBe(401);
  });
});
