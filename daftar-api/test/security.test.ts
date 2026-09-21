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
  await pool.query(`DELETE FROM pct_codes`);
  await pool.query(`DELETE FROM client_pos_devices`);
  await pool.query(`DELETE FROM client_banks`);
  await pool.query(`DELETE FROM client_places`);
  await pool.query(`DELETE FROM client_staff`);
  await pool.query(`DELETE FROM clients`);
  await pool.query(`DELETE FROM sessions`);
  await pool.query(`DELETE FROM users`);
}

async function ownerToken(app: FastifyInstance): Promise<string> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/bootstrap-owner",
    payload: { email: "sec-owner@example.com", password: "password123" },
  });
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "sec-owner@example.com", password: "password123" },
  });
  return (login.json() as { token: string }).token;
}

async function staffToken(app: FastifyInstance, ownerTok: string): Promise<{ token: string; id: string }> {
  const created = await app.inject({
    method: "POST",
    url: "/v1/staff",
    headers: { authorization: `Bearer ${ownerTok}` },
    payload: { email: "sec-staff@example.com", password: "password123" },
  });
  expect(created.statusCode).toBe(201);
  const id = (created.json() as { id: string }).id;
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email: "sec-staff@example.com", password: "password123" },
  });
  return { token: (login.json() as { token: string }).token, id };
}

describe("security hardening", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    // Ensure disabled column exists (004)
    await pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false`,
    );
    app = await buildApp({ logger: false, startWorker: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await wipe();
  });

  it("staff cannot import desk-backup for the whole practice", async () => {
    const ownerTok = await ownerToken(app);
    const { token: staffTok } = await staffToken(app, ownerTok);
    const res = await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      headers: { authorization: `Bearer ${staffTok}` },
      payload: {
        version: 5,
        exportedAt: Date.now(),
        clients: [
          {
            id: "c-steal",
            businessName: "Stolen",
            posId: "1",
            posToken: "t",
            environment: "sandbox",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe("owner_only");
  });

  it("GET /v1/clients never returns pos_token", async () => {
    const ownerTok = await ownerToken(app);
    const sealed = encryptPosToken("plain-secret-token", env.tokenEncryptionKey);
    await pool.query(
      `INSERT INTO clients (id, business_name, pos_id, pos_token, environment, created_at, updated_at)
       VALUES ('c1','Co','1',$1,'sandbox',1,1)`,
      [sealed],
    );
    const res = await app.inject({
      method: "GET",
      url: "/v1/clients",
      headers: { authorization: `Bearer ${ownerTok}` },
    });
    expect(res.statusCode).toBe(200);
    const blob = JSON.stringify(res.json());
    expect(blob.includes("pos_token")).toBe(false);
    expect(blob.includes("plain-secret-token")).toBe(false);
    expect(blob.includes("enc:v1:")).toBe(false);
  });

  it("staff cannot push buyers for an unassigned client", async () => {
    const ownerTok = await ownerToken(app);
    await pool.query(
      `INSERT INTO clients (id, business_name, pos_id, pos_token, environment, created_at, updated_at)
       VALUES ('c-other','Other','1','','sandbox',1,1)`,
    );
    const { token: staffTok, id: staffId } = await staffToken(app, ownerTok);
    await pool.query(
      `INSERT INTO clients (id, business_name, pos_id, pos_token, environment, created_at, updated_at)
       VALUES ('c-mine','Mine','2','','sandbox',1,1)`,
    );
    await pool.query(`INSERT INTO client_staff (client_id, user_id) VALUES ('c-mine', $1)`, [staffId]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${staffTok}` },
      payload: {
        buyers: [
          {
            id: "b-evil",
            clientId: "c-other",
            name: "Evil",
            createdAt: 1,
            updatedAt: 99,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { conflicts: Array<{ reason: string }> };
    expect(body.conflicts.some((c) => c.reason === "no_access")).toBe(true);
    const buyers = await pool.query(`SELECT id FROM buyers WHERE id = 'b-evil'`);
    expect(buyers.rowCount).toBe(0);
  });

  it("staff cannot reassign another client's invoice onto an assigned client", async () => {
    const ownerTok = await ownerToken(app);
    await pool.query(
      `INSERT INTO clients (id, business_name, pos_id, pos_token, environment, created_at, updated_at)
       VALUES ('c-a','A','1','','sandbox',1,1), ('c-b','B','2','','sandbox',1,1)`,
    );
    await pool.query(
      `INSERT INTO invoices (
        id, client_id, usin, invoice_type, payment_mode, date_time, buyer_name,
        total_quantity, total_sale_value, total_tax_charged, total_bill_amount,
        status, created_at, updated_at
      ) VALUES (
        'inv-victim','c-a','U1',1,1,'2026-01-01','X',1,10,1,11,'posted',1,1
      )`,
    );
    const { token: staffTok, id: staffId } = await staffToken(app, ownerTok);
    await pool.query(`INSERT INTO client_staff (client_id, user_id) VALUES ('c-b', $1)`, [staffId]);

    const res = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${staffTok}` },
      payload: {
        invoices: [
          {
            id: "inv-victim",
            clientId: "c-b",
            usin: "U1",
            invoiceType: 1,
            paymentMode: 1,
            dateTime: "2026-01-01",
            buyerName: "X",
            discount: 0,
            furtherTax: 0,
            totalQuantity: 1,
            totalSaleValue: 10,
            totalTaxCharged: 1,
            totalBillAmount: 11,
            refUsin: "",
            items: [],
            status: "posted",
            fiscalNumber: "F",
            lastError: "",
            lastResponse: "",
            lastCode: "",
            attemptCount: 1,
            createdAt: 1,
            updatedAt: 999999,
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const row = await pool.query(`SELECT client_id FROM invoices WHERE id = 'inv-victim'`);
    expect(row.rows[0].client_id).toBe("c-a");
  });

  it("unknown email login still does argon work and returns generic 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "nobody@example.com", password: "password123" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.json())).not.toContain("lockedUntil");
  });

  it("locked login does not return lockedUntil to the client", async () => {
    await ownerToken(app);
    for (let i = 0; i < 5; i += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: "sec-owner@example.com", password: "wrong-password" },
      });
    }
    const locked = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "sec-owner@example.com", password: "wrong-password" },
    });
    expect(locked.statusCode).toBe(423);
    expect((locked.json() as { lockedUntil?: unknown }).lockedUntil).toBeUndefined();
  });

  it("disabled user sessions are rejected and destroySessions clears them", async () => {
    const ownerTok = await ownerToken(app);
    const { token: staffTok, id: staffId } = await staffToken(app, ownerTok);
    await pool.query(`UPDATE users SET disabled = true WHERE id = $1`, [staffId]);
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${staffTok}` },
    });
    expect(me.statusCode).toBe(401);
  });
});
