import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { env } from "../src/env.js";
import { decryptPosToken, isEncryptedPosToken } from "../src/crypto/posToken.js";

async function wipe(): Promise<void> {
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

describe("sync CRUD + merge", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    app = await buildApp({ logger: false });
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
      payload: { email: "sync@example.com", password: "password123" },
    });
    expect(boot.statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "sync@example.com", password: "password123" },
    });
    const body = login.json() as { token: string };
    token = body.token;
  });

  it("push then pull maps camelCase and never returns posToken", async () => {
    const push = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clients: [
          {
            id: "c-sync",
            businessName: "Sync Co",
            brandName: "",
            pntn: "1",
            cnic: "",
            phone: "",
            email: "",
            address: "",
            city: "Lahore",
            sector: "",
            branchName: "",
            posId: "P1",
            posToken: "secret-sync-token",
            environment: "sandbox",
            notes: "",
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        invoices: [
          {
            id: "inv-sync",
            clientId: "c-sync",
            usin: "U-1",
            invoiceType: 1,
            paymentMode: 1,
            dateTime: "2026-04-01T12:00:00",
            buyerName: "Buyer",
            buyerPntn: "",
            buyerCnic: "",
            buyerPhone: "",
            discount: 0,
            furtherTax: 0,
            totalQuantity: 1,
            totalSaleValue: 50,
            totalTaxCharged: 8,
            totalBillAmount: 58,
            refUsin: "",
            items: [],
            status: "draft",
            fiscalNumber: "",
            lastError: "",
            lastResponse: "",
            lastCode: "",
            attemptCount: 0,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        buyers: [
          {
            id: "b1",
            clientId: "c-sync",
            name: "Buyer",
            pntn: "",
            cnic: "",
            phone: "",
            notes: "",
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        items: [
          {
            id: "i1",
            clientId: "c-sync",
            itemCode: "X",
            itemName: "Item",
            pctCode: "0112.0000.0",
            taxRate: 16,
            createdAt: 10,
            updatedAt: 10,
          },
        ],
        purchases: [],
        returns: [],
        psids: [],
      },
    });
    expect(push.statusCode).toBe(200);
    expect((push.json() as { applied: number }).applied).toBeGreaterThan(0);

    const raw = await pool.query(`SELECT pos_token FROM clients WHERE id = 'c-sync'`);
    expect(isEncryptedPosToken(String(raw.rows[0].pos_token))).toBe(true);
    expect(String(raw.rows[0].pos_token).includes("secret-sync-token")).toBe(false);
    expect(decryptPosToken(String(raw.rows[0].pos_token), env.tokenEncryptionKey)).toBe(
      "secret-sync-token",
    );

    const pull = await app.inject({
      method: "GET",
      url: "/v1/sync/pull?sinceMs=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(pull.statusCode).toBe(200);
    const body = pull.json() as {
      clients: Array<Record<string, unknown>>;
      invoices: Array<Record<string, unknown>>;
      buyers: Array<Record<string, unknown>>;
      items: Array<Record<string, unknown>>;
    };
    expect(body.clients[0].businessName).toBe("Sync Co");
    expect(body.clients[0].posToken).toBe("");
    expect(JSON.stringify(body).includes("secret-sync-token")).toBe(false);
    expect(body.invoices[0].buyerName).toBe("Buyer");
    expect(body.buyers[0].name).toBe("Buyer");
    expect(body.items[0].itemCode).toBe("X");
  });

  it("never downgrades posted invoice on push", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clients: [
          {
            id: "c2",
            businessName: "Posted Co",
            brandName: "",
            pntn: "",
            cnic: "",
            phone: "",
            email: "",
            address: "",
            city: "",
            sector: "",
            branchName: "",
            posId: "",
            posToken: "t",
            environment: "sandbox",
            notes: "",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        invoices: [
          {
            id: "inv-p",
            clientId: "c2",
            usin: "UP",
            invoiceType: 1,
            paymentMode: 1,
            dateTime: "2026-04-02T10:00:00",
            buyerName: "A",
            buyerPntn: "",
            buyerCnic: "",
            buyerPhone: "",
            discount: 0,
            furtherTax: 0,
            totalQuantity: 1,
            totalSaleValue: 1,
            totalTaxCharged: 0,
            totalBillAmount: 1,
            refUsin: "",
            items: [],
            status: "posted",
            fiscalNumber: "F-99",
            lastError: "",
            lastResponse: "",
            lastCode: "",
            attemptCount: 1,
            createdAt: 1,
            updatedAt: 5,
          },
        ],
      },
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/sync/push",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clients: [],
        invoices: [
          {
            id: "inv-p",
            clientId: "c2",
            usin: "UP",
            invoiceType: 1,
            paymentMode: 1,
            dateTime: "2026-04-02T10:00:00",
            buyerName: "A",
            buyerPntn: "",
            buyerCnic: "",
            buyerPhone: "",
            discount: 0,
            furtherTax: 0,
            totalQuantity: 1,
            totalSaleValue: 1,
            totalTaxCharged: 0,
            totalBillAmount: 1,
            refUsin: "",
            items: [],
            status: "draft",
            fiscalNumber: "",
            lastError: "",
            lastResponse: "",
            lastCode: "",
            attemptCount: 0,
            createdAt: 1,
            updatedAt: 99,
          },
        ],
      },
    });
    const body = second.json() as { conflicts: Array<{ reason: string }> };
    expect(body.conflicts.some((c) => c.reason === "never_downgrade_posted")).toBe(true);
    const row = await pool.query(`SELECT status, fiscal_number FROM invoices WHERE id = 'inv-p'`);
    expect(row.rows[0]).toMatchObject({ status: "posted", fiscal_number: "F-99" });
  });
});
