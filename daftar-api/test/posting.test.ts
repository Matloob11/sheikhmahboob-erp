import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { pool } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { env } from "../src/env.js";
import { encryptPosToken } from "../src/crypto/posToken.js";
import { awaitWorkerIdle, drainWorkerForTests, tickWorker } from "../src/posting/worker.js";
import { recoverCrashedSends, getQueueByClientUsin } from "../src/posting/queue.js";
import {
  fakePraCallCount,
  installFakePra,
  setFakePraMode,
  uninstallFakePra,
} from "./fakePra.js";

async function wipe(): Promise<void> {
  await pool.query(`DELETE FROM post_attempts`);
  await pool.query(`DELETE FROM post_queue`);
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

async function seedClient(opts?: {
  id?: string;
  mode?: "browser" | "server";
  environment?: "sandbox" | "production";
}): Promise<string> {
  const id = opts?.id ?? "c-post";
  const token = encryptPosToken("test-pos-token", env.tokenEncryptionKey);
  await pool.query(
    `INSERT INTO clients (
      id, business_name, pos_id, pos_token, environment, posting_mode, created_at, updated_at
    ) VALUES ($1,'Post Co','123',$2,$3,$4,1,1)`,
    [id, token, opts?.environment ?? "sandbox", opts?.mode ?? "server"],
  );
  return id;
}

const samplePayload = {
  InvoiceNumber: "",
  POSID: 123,
  USIN: "USIN-M3-1",
  DateTime: "2026-04-01 10:00:00",
  BuyerPNTN: "",
  BuyerCNIC: "",
  BuyerName: "Buyer",
  BuyerPhoneNumber: "",
  TotalBillAmount: 116,
  TotalQuantity: 1,
  TotalSaleValue: 100,
  TotalTaxCharged: 16,
  Discount: 0,
  FurtherTax: 0,
  PaymentMode: 1,
  RefUSIN: null,
  InvoiceType: 1,
  Items: [],
};

describe("M3 server posting", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await pool.query("SELECT 1");
    // Ensure migration 003 applied
    await pool.query(`SELECT posting_mode FROM clients LIMIT 0`).catch(async () => {
      // migrate should have run; if not, fail clearly
      throw new Error("Run daftar-api migrate before tests (missing posting_mode)");
    });
    // Tests drain manually; keep per-client gap at 0 so retries are not delayed.
    (env as { praClientGapMs: number }).praClientGapMs = 0;
    installFakePra();
    app = await buildApp({ logger: false, startWorker: false });
    await app.ready();
  });

  afterAll(async () => {
    uninstallFakePra();
    await app.close();
  });

  beforeEach(async () => {
    await wipe();
    setFakePraMode("code_100");
    const boot = await app.inject({
      method: "POST",
      url: "/v1/auth/bootstrap-owner",
      payload: { email: "post@example.com", password: "password123" },
    });
    expect([201, 409]).toContain(boot.statusCode);
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "post@example.com", password: "password123" },
    });
    token = (login.json() as { token: string }).token;
  });

  async function enqueue(over?: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/v1/post/enqueue",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        clientId: "c-post",
        invoiceId: "inv-1",
        usin: "USIN-M3-1",
        environment: "sandbox",
        posId: "123",
        payload: samplePayload,
        ...over,
      },
    });
  }

  it("posts code 100 via fake PRA", async () => {
    await seedClient();
    setFakePraMode("code_100");
    const res = await enqueue();
    expect(res.statusCode).toBe(200);
    await drainWorkerForTests();
    const job = await getQueueByClientUsin("c-post", "USIN-M3-1");
    expect(job?.status).toBe("posted");
    expect(job?.fiscal_number).toMatch(/^\d+$/);
    expect(fakePraCallCount()).toBeGreaterThanOrEqual(1);
  });

  it("posts code 00", async () => {
    await seedClient();
    setFakePraMode("code_00");
    await enqueue({ usin: "USIN-00" });
    await drainWorkerForTests();
    const job = await getQueueByClientUsin("c-post", "USIN-00");
    expect(job?.status).toBe("posted");
  });

  it("marks rejection failed", async () => {
    await seedClient();
    setFakePraMode("reject");
    await enqueue({ usin: "USIN-REJ" });
    await drainWorkerForTests();
    const job = await getQueueByClientUsin("c-post", "USIN-REJ");
    expect(job?.status).toBe("failed");
    expect(job?.last_code).toBe("201");
  });

  it("duplicate USIN becomes unknown", async () => {
    await seedClient();
    setFakePraMode("duplicate_usin");
    await enqueue({ usin: "USIN-DUP" });
    await drainWorkerForTests();
    const job = await getQueueByClientUsin("c-post", "USIN-DUP");
    expect(job?.status).toBe("unknown");
  });

  it("timeout becomes unknown", async () => {
    await seedClient();
    setFakePraMode("timeout");
    const prev = env.praFetchMs;
    (env as { praFetchMs: number }).praFetchMs = 50;
    await enqueue({ usin: "USIN-TO" });
    await drainWorkerForTests();
    (env as { praFetchMs: number }).praFetchMs = prev;
    const job = await getQueueByClientUsin("c-post", "USIN-TO");
    expect(job?.status).toBe("unknown");
  });

  it("5xx becomes unknown", async () => {
    await seedClient();
    setFakePraMode("http_500");
    await enqueue({ usin: "USIN-500" });
    await drainWorkerForTests();
    expect((await getQueueByClientUsin("c-post", "USIN-500"))?.status).toBe("unknown");
  });

  it("HTML body becomes unknown", async () => {
    await seedClient();
    setFakePraMode("html");
    await enqueue({ usin: "USIN-HTML" });
    await drainWorkerForTests();
    expect((await getQueueByClientUsin("c-post", "USIN-HTML"))?.status).toBe("unknown");
  });

  it("connection refused returns to pending for retry", async () => {
    await seedClient();
    setFakePraMode("refused");
    await enqueue({ usin: "USIN-REF" });
    await drainWorkerForTests();
    const job = await getQueueByClientUsin("c-post", "USIN-REF");
    expect(job?.status).toBe("pending");
  });

  it("crash mid-send recovers to unknown never pending", async () => {
    await seedClient();
    setFakePraMode("crash_mid_send");
    await enqueue({ usin: "USIN-CRASH" });
    // Enqueue nudges the worker; wait for the crash to leave the row in sending.
    await awaitWorkerIdle();
    let mid = await getQueueByClientUsin("c-post", "USIN-CRASH");
    if (mid?.status === "pending") {
      await tickWorker();
      mid = await getQueueByClientUsin("c-post", "USIN-CRASH");
    }
    expect(mid?.status).toBe("sending");
    const n = await recoverCrashedSends();
    expect(n).toBe(1);
    const after = await getQueueByClientUsin("c-post", "USIN-CRASH");
    expect(after?.status).toBe("unknown");
  });

  it("UNIQUE (client_id, usin) blocks concurrent double enqueue from posting twice", async () => {
    await seedClient();
    setFakePraMode("code_100");
    const [a, b] = await Promise.all([
      enqueue({ usin: "USIN-RACE", invoiceId: "inv-a" }),
      enqueue({ usin: "USIN-RACE", invoiceId: "inv-b" }),
    ]);
    expect(a.statusCode).toBe(200);
    // Second may be 200 (re-queue same pending) or 409 if first already sending/posted
    expect([200, 409]).toContain(b.statusCode);
    await drainWorkerForTests();
    expect(fakePraCallCount()).toBe(1);
    const job = await getQueueByClientUsin("c-post", "USIN-RACE");
    expect(job?.status).toBe("posted");
  });

  it("production requires confirmProduction", async () => {
    await seedClient({ environment: "production" });
    const res = await enqueue({ environment: "production", usin: "USIN-PROD" });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("production_needs_confirm");
  });

  it("browser mode rejects enqueue", async () => {
    await seedClient({ mode: "browser" });
    const res = await enqueue({ usin: "USIN-BR" });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe("mode_browser");
  });

  it("owner status endpoint", async () => {
    await seedClient();
    setFakePraMode("reject");
    await enqueue({ usin: "USIN-ST" });
    await drainWorkerForTests();
    const res = await app.inject({
      method: "GET",
      url: "/v1/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { depth: { failed: number } };
    expect(body.depth.failed).toBeGreaterThanOrEqual(1);
  });

  it("audit attempt has no token", async () => {
    await seedClient();
    setFakePraMode("code_100");
    await enqueue({ usin: "USIN-AUD" });
    await drainWorkerForTests();
    const attempts = await pool.query(`SELECT raw_response, payload_hash FROM post_attempts`);
    const blob = JSON.stringify(attempts.rows);
    expect(blob.includes("test-pos-token")).toBe(false);
    expect(attempts.rows[0].payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
