import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";

async function wipe(): Promise<void> {
  await pool.query(`DELETE FROM audit_events`);
  await pool.query(`DELETE FROM import_runs`);
  await pool.query(`DELETE FROM client_staff`);
  await pool.query(`DELETE FROM sessions`);
  await pool.query(`DELETE FROM users`);
  await pool.query(`DELETE FROM clients`).catch(() => undefined);
}

describe("staff management", () => {
  let app: FastifyInstance;
  let ownerTok: string;

  beforeAll(async () => {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false`);
    app = await buildApp({ logger: false, startWorker: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await wipe();
    const boot = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "owner-staff@example.com", password: "password123" },
    });
    expect(boot.statusCode).toBe(201);
    ownerTok = (boot.json() as { token: string }).token;
  });

  it("owner creates staff, resets password, disables and logs them out", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/staff",
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: { email: "worker@example.com", password: "password123" },
    });
    expect(created.statusCode).toBe(201);
    const staffId = (created.json() as { id: string }).id;

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "worker@example.com", password: "password123" },
    });
    const staffTok = (login.json() as { token: string }).token;

    const reset = await app.inject({
      method: "POST",
      url: `/v1/staff/${staffId}/reset-password`,
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: { password: "password456" },
    });
    expect(reset.statusCode).toBe(200);

    const oldMe = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${staffTok}` },
    });
    expect(oldMe.statusCode).toBe(401);

    const reLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "worker@example.com", password: "password456" },
    });
    expect(reLogin.statusCode).toBe(200);
    const tok2 = (reLogin.json() as { token: string }).token;

    const disable = await app.inject({
      method: "PATCH",
      url: `/v1/staff/${staffId}`,
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: { disabled: true },
    });
    expect(disable.statusCode).toBe(200);

    const me2 = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${tok2}` },
    });
    expect(me2.statusCode).toBe(401);

    const loginDisabled = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "worker@example.com", password: "password456" },
    });
    expect(loginDisabled.statusCode).toBe(401);

    const audits = await pool.query(
      `SELECT kind FROM audit_events WHERE kind LIKE 'staff.%' ORDER BY at`,
    );
    const kinds = audits.rows.map((r) => r.kind);
    expect(kinds).toContain("staff.created");
    expect(kinds).toContain("staff.password_reset");
    expect(kinds).toContain("staff.disabled");
  });
});
