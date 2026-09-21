import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { encryptPosToken } from "../src/crypto/posToken.js";
import { env } from "../src/env.js";

async function wipe(): Promise<void> {
  await pool.query(`DELETE FROM post_attempts`).catch(() => undefined);
  await pool.query(`DELETE FROM post_queue`).catch(() => undefined);
  await pool.query(`DELETE FROM audit_events`);
  await pool.query(`DELETE FROM import_runs`);
  await pool.query(`DELETE FROM desk_events`);
  await pool.query(`DELETE FROM invoices`);
  await pool.query(`DELETE FROM purchases`);
  await pool.query(`DELETE FROM returns`);
  await pool.query(`DELETE FROM psids`);
  await pool.query(`DELETE FROM buyers`);
  await pool.query(`DELETE FROM catalog_items`);
  await pool.query(`DELETE FROM client_staff`);
  await pool.query(`DELETE FROM clients`);
  await pool.query(`DELETE FROM sessions`);
  await pool.query(`DELETE FROM users`);
}

async function seedClients(): Promise<void> {
  await pool.query(
    `INSERT INTO clients (id, business_name, pos_id, pos_token, environment, created_at, updated_at)
     VALUES
       ('c-mine','Mine Co','1','','sandbox',1,1),
       ('c-other','Other Co','2','','sandbox',1,1)`,
  );
}

describe("business role", () => {
  let app: FastifyInstance;
  let ownerTok: string;
  let bizTok: string;
  let bizId: string;

  beforeAll(async () => {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await pool.query(
      `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'staff', 'business'))`,
    );
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
      payload: { email: "biz-owner@example.com", password: "password123" },
    });
    expect(boot.statusCode).toBe(201);
    ownerTok = (boot.json() as { token: string }).token;
    await seedClients();

    const created = await app.inject({
      method: "POST",
      url: "/v1/business",
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: {
        email: "biz@example.com",
        password: "password123",
        clientId: "c-mine",
      },
    });
    expect(created.statusCode).toBe(201);
    bizId = (created.json() as { id: string }).id;
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "biz@example.com", password: "password123" },
    });
    expect(login.statusCode).toBe(200);
    bizTok = (login.json() as { token: string }).token;
    expect((login.json() as { role: string }).role).toBe("business");
  });

  it("lists only its own client", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/clients",
      headers: { authorization: `Bearer ${bizTok}` },
    });
    expect(res.statusCode).toBe(200);
    const clients = (res.json() as { clients: Array<{ id: string }> }).clients;
    expect(clients.map((c) => c.id)).toEqual(["c-mine"]);
  });

  it("pull never returns another client's rows", async () => {
    await pool.query(
      `INSERT INTO buyers (id, client_id, name, created_at, updated_at)
       VALUES ('b-other','c-other','Secret',1,1), ('b-mine','c-mine','Ok',1,1)`,
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/sync/pull?sinceMs=0",
      headers: { authorization: `Bearer ${bizTok}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      clients: Array<{ id: string }>;
      buyers: Array<{ id: string; clientId: string }>;
    };
    expect(body.clients.map((c) => c.id)).toEqual(["c-mine"]);
    expect(body.buyers.map((b) => b.id)).toEqual(["b-mine"]);
  });

  it("push to another client is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${bizTok}` },
      payload: {
        buyers: [
          {
            id: "b-evil",
            clientId: "c-other",
            name: "Evil",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conflicts: Array<{ reason: string }> };
    expect(body.conflicts.some((c) => c.reason === "no_access")).toBe(true);
    const rows = await pool.query(`SELECT id FROM buyers WHERE id = 'b-evil'`);
    expect(rows.rowCount).toBe(0);
  });

  it("post enqueue/get/by-usin/reconcile for another client are 403", async () => {
    const enqueue = await app.inject({
      method: "POST",
      url: "/v1/post/enqueue",
      headers: { authorization: `Bearer ${bizTok}` },
      payload: {
        clientId: "c-other",
        invoiceId: "inv-x",
        usin: "U-X",
        environment: "sandbox",
        posId: "2",
        payload: { InvoiceNumber: "U-X" },
      },
    });
    expect(enqueue.statusCode).toBe(403);

    await pool.query(
      `INSERT INTO post_queue (
         id, client_id, invoice_id, usin, environment, pos_id, payload, payload_hash,
         status, created_at, updated_at
       ) VALUES (
         'q-other','c-other','inv-o','U-O','sandbox','2','{}','h','unknown',now(),now()
       )`,
    );

    const get = await app.inject({
      method: "GET",
      url: "/v1/post/q-other",
      headers: { authorization: `Bearer ${bizTok}` },
    });
    expect(get.statusCode).toBe(403);

    const byUsin = await app.inject({
      method: "GET",
      url: "/v1/post/by-usin?clientId=c-other&usin=U-O",
      headers: { authorization: `Bearer ${bizTok}` },
    });
    expect(byUsin.statusCode).toBe(403);

    const reconcile = await app.inject({
      method: "POST",
      url: "/v1/post/q-other/reconcile",
      headers: { authorization: `Bearer ${bizTok}` },
      payload: { decision: "not_posted" },
    });
    expect(reconcile.statusCode).toBe(403);
  });

  it("owner-only routes return 403", async () => {
    const paths: Array<{ method: "GET" | "POST" | "PATCH"; url: string; payload?: object }> = [
      { method: "GET", url: "/v1/status" },
      { method: "GET", url: "/v1/import/summary" },
      { method: "POST", url: "/v1/import/desk-backup", payload: { version: 5, exportedAt: 1, clients: [] } },
      { method: "GET", url: "/v1/staff" },
      { method: "POST", url: "/v1/staff", payload: { email: "x@example.com", password: "password123" } },
      { method: "GET", url: "/v1/business" },
      { method: "POST", url: "/v1/business", payload: { email: "y@example.com", password: "password123", clientId: "c-mine" } },
      { method: "PATCH", url: "/v1/clients/c-mine/posting-mode", payload: { postingMode: "browser" } },
    ];
    for (const path of paths) {
      const res = await app.inject({
        method: path.method,
        url: path.url,
        headers: { authorization: `Bearer ${bizTok}` },
        payload: path.payload,
      });
      expect(res.statusCode, path.url).toBe(403);
      expect((res.json() as { error: string }).error).toBe("owner_only");
    }
  });

  it("cannot change POS token after it is set; owner can", async () => {
    const sealed = encryptPosToken("token-set", env.tokenEncryptionKey);
    await pool.query(`UPDATE clients SET pos_token = $1, updated_at = 10 WHERE id = 'c-mine'`, [sealed]);

    const bizPush = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${bizTok}` },
      payload: {
        clients: [
          {
            id: "c-mine",
            businessName: "Mine Co",
            posId: "1",
            posToken: "token-stolen",
            environment: "sandbox",
            createdAt: 1,
            updatedAt: 999,
          },
        ],
      },
    });
    expect(bizPush.statusCode).toBe(200);
    const conflicts = (bizPush.json() as { conflicts: Array<{ reason: string }> }).conflicts;
    expect(conflicts.some((c) => c.reason === "pos_token_locked")).toBe(true);

    const stored = await pool.query<{ pos_token: string }>(
      `SELECT pos_token FROM clients WHERE id = 'c-mine'`,
    );
    expect(stored.rows[0].pos_token).toBe(sealed);

    const ownerPush = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: {
        clients: [
          {
            id: "c-mine",
            businessName: "Mine Co",
            posId: "1",
            posToken: "token-owner-new",
            environment: "sandbox",
            createdAt: 1,
            updatedAt: 1000,
          },
        ],
      },
    });
    expect(ownerPush.statusCode).toBe(200);
    const after = await pool.query<{ pos_token: string }>(
      `SELECT pos_token FROM clients WHERE id = 'c-mine'`,
    );
    expect(after.rows[0].pos_token).not.toBe(sealed);
    expect(after.rows[0].pos_token.startsWith("enc:v1:")).toBe(true);
  });

  it("owner creates, resets password, disables business user", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/v1/business",
      headers: { authorization: `Bearer ${ownerTok}` },
    });
    expect(list.statusCode).toBe(200);
    const rows = (list.json() as { business: Array<{ id: string; clientId: string }> }).business;
    expect(rows.some((r) => r.id === bizId && r.clientId === "c-mine")).toBe(true);

    const reset = await app.inject({
      method: "POST",
      url: `/v1/business/${bizId}/reset-password`,
      headers: { authorization: `Bearer ${ownerTok}` },
      payload: { password: "password456" },
    });
    expect(reset.statusCode).toBe(200);

    const oldMe = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${bizTok}` },
    });
    expect(oldMe.statusCode).toBe(401);

    const reLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "biz@example.com", password: "password456" },
    });
    expect(reLogin.statusCode).toBe(200);
    const tok2 = (reLogin.json() as { token: string }).token;

    const disable = await app.inject({
      method: "PATCH",
      url: `/v1/business/${bizId}`,
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

    const audits = await pool.query(
      `SELECT kind FROM audit_events WHERE kind LIKE 'business.%' ORDER BY at`,
    );
    const kinds = audits.rows.map((r) => r.kind);
    expect(kinds).toContain("business.created");
    expect(kinds).toContain("business.password_reset");
    expect(kinds).toContain("business.disabled");
  });
});
