import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { env } from "../src/env.js";

async function wipeDesk(): Promise<void> {
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
  await pool.query(`DELETE FROM clients`);
  await pool.query(`DELETE FROM sessions`);
  await pool.query(`DELETE FROM users`);
}

function miniBackup(overrides?: Record<string, unknown>) {
  return {
    version: 5 as const,
    exportedAt: 1_700_000_000_000,
    tokenHandling: "plain",
    clients: [
      {
        id: "c1",
        businessName: "Ahmad Traders",
        brandName: "Ahmad",
        pntn: "123",
        cnic: "",
        phone: "",
        email: "",
        address: "",
        city: "Lahore",
        sector: "",
        branchName: "",
        posId: "POS1",
        posToken: "token-alive",
        environment: "sandbox",
        notes: "",
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    invoices: [
      {
        id: "inv1",
        clientId: "c1",
        usin: "USIN-1",
        invoiceType: 1,
        paymentMode: 1,
        dateTime: "2026-03-15T10:00:00",
        buyerName: "Buyer",
        buyerPntn: "",
        buyerCnic: "",
        buyerPhone: "",
        discount: 0,
        furtherTax: 0,
        totalQuantity: 1,
        totalSaleValue: 100,
        totalTaxCharged: 16,
        totalBillAmount: 116,
        refUsin: "",
        items: [],
        status: "draft",
        fiscalNumber: "",
        lastError: "",
        lastResponse: "",
        lastCode: "",
        attemptCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    purchases: [],
    returns: [],
    psids: [],
    events: [],
    buyers: [],
    items: [],
    pctCodes: [],
    clientPlaces: [],
    clientBanks: [],
    clientPosDevices: [],
    ...overrides,
  };
}

describe("import", () => {
  let app: FastifyInstance;
  let sessionCookie: string;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    app = await buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await wipeDesk();
    const boot = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "import@example.com", password: "password123" },
    });
    expect(boot.statusCode).toBe(201);
    const cookie = boot.cookies.find((c) => c.name === env.cookieName);
    sessionCookie = cookie!.value;
  });

  it("upserts clients and invoices from a mini DeskBackup", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      cookies: { [env.cookieName]: sessionCookie },
      payload: miniBackup(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { counts: { clients: number; invoices: number } };
    expect(body.counts.clients).toBe(1);
    expect(body.counts.invoices).toBe(1);

    const client = await pool.query(`SELECT business_name, pos_token FROM clients WHERE id = 'c1'`);
    expect(client.rows[0]).toMatchObject({ business_name: "Ahmad Traders", pos_token: "token-alive" });
    const inv = await pool.query(`SELECT period, usin FROM invoices WHERE id = 'inv1'`);
    expect(inv.rows[0]).toMatchObject({ period: "2026-03", usin: "USIN-1" });
  });

  it("second import updates and empty token does not wipe existing", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      cookies: { [env.cookieName]: sessionCookie },
      payload: miniBackup(),
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      cookies: { [env.cookieName]: sessionCookie },
      payload: miniBackup({
        clients: [
          {
            id: "c1",
            businessName: "Ahmad Traders Updated",
            brandName: "Ahmad",
            pntn: "123",
            cnic: "",
            phone: "",
            email: "",
            address: "",
            city: "Lahore",
            sector: "",
            branchName: "",
            posId: "POS1",
            posToken: "",
            environment: "sandbox",
            notes: "",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        invoices: [
          {
            id: "inv1",
            clientId: "c1",
            usin: "USIN-1",
            invoiceType: 1,
            paymentMode: 1,
            dateTime: "2026-03-15T10:00:00",
            buyerName: "Buyer 2",
            buyerPntn: "",
            buyerCnic: "",
            buyerPhone: "",
            discount: 0,
            furtherTax: 0,
            totalQuantity: 2,
            totalSaleValue: 200,
            totalTaxCharged: 32,
            totalBillAmount: 232,
            refUsin: "",
            items: [],
            status: "validated",
            fiscalNumber: "",
            lastError: "",
            lastResponse: "",
            lastCode: "",
            attemptCount: 0,
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      }),
    });
    expect(second.statusCode).toBe(200);

    const client = await pool.query(`SELECT business_name, pos_token FROM clients WHERE id = 'c1'`);
    expect(client.rows[0].business_name).toBe("Ahmad Traders Updated");
    expect(client.rows[0].pos_token).toBe("token-alive");

    const inv = await pool.query(`SELECT buyer_name, status FROM invoices WHERE id = 'inv1'`);
    expect(inv.rows[0]).toMatchObject({ buyer_name: "Buyer 2", status: "validated" });
  });

  it("holds unique non-empty (client_id, usin)", async () => {
    await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      cookies: { [env.cookieName]: sessionCookie },
      payload: miniBackup(),
    });

    await expect(
      pool.query(
        `INSERT INTO invoices (id, client_id, usin, date_time) VALUES ('inv2', 'c1', 'USIN-1', '2026-03-16')`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("writes audit with actor_user_id", async () => {
    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      cookies: { [env.cookieName]: sessionCookie },
    });
    const { id: actorId } = me.json() as { id: string };

    await app.inject({
      method: "POST",
      url: "/v1/import/desk-backup",
      cookies: { [env.cookieName]: sessionCookie },
      payload: miniBackup(),
    });

    const audit = await pool.query(
      `SELECT actor_user_id, kind FROM audit_events WHERE kind = 'import.desk_backup' ORDER BY at DESC LIMIT 1`,
    );
    expect(audit.rows[0]).toMatchObject({ actor_user_id: actorId, kind: "import.desk_backup" });
  });
});
