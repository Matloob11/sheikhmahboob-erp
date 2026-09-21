/**
 * Desk usable while daftar-api is down.
 * phase=down  — open /pra/, write a posted invoice into Dexie, queue sync, screenshot.
 * phase=drain — same browser profile, Sync now, queue clears, screenshot.
 *
 * Env: DAFTAR_API_EMAIL, DAFTAR_API_PASSWORD, M2_PHASE=down|drain
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../artifacts/m2-offline");
const PROFILE = resolve(OUT, "profile");
const BASE = process.env.DAFTAR_DESK_URL || "https://sheikhmahboob.com/pra/";
const phaseArg = process.argv.find((a) => a.startsWith("--phase="));
const PHASE = phaseArg ? phaseArg.slice("--phase=".length) : process.env.M2_PHASE || "down";
let EMAIL = process.env.DAFTAR_API_EMAIL || "";
let PASSWORD = process.env.DAFTAR_API_PASSWORD || "";
const credArg = process.argv.find((a) => a.startsWith("--cred-file="));
if ((!EMAIL || !PASSWORD) && credArg) {
  const raw = readFileSync(credArg.slice("--cred-file=".length), "utf8").replace(/\r/g, "");
  const [email, pass] = raw.split("\n");
  EMAIL = email || "";
  PASSWORD = pass || "";
}

mkdirSync(OUT, { recursive: true });

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function launch() {
  return chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
}

async function phaseDown() {
  const context = await launch();
  const page = context.pages()[0] || (await context.newPage());
  const res = await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  must(res && res.status() === 200, `desk status ${res && res.status()}`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: resolve(OUT, "desk-api-down.png"), fullPage: true });

  const written = await page.evaluate(async () => {
    const now = Date.now();
    const clientId = `cli-off-${now}`;
    const invoiceId = `inv-off-${now}`;
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("daftar-pra");
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const client = {
      id: clientId,
      businessName: "Offline proof",
      brandName: "",
      pntn: "",
      cnic: "",
      phone: "",
      email: "",
      address: "",
      city: "Lahore",
      sector: "",
      branchName: "",
      posId: "OFF",
      posToken: "local-dexie-only",
      environment: "sandbox",
      notes: "created while daftar-api stopped",
      createdAt: now,
      updatedAt: now,
    };
    const invoice = {
      id: invoiceId,
      clientId,
      usin: `OFF-${now}`,
      invoiceType: 1,
      paymentMode: 1,
      dateTime: new Date(now).toISOString().slice(0, 19),
      buyerName: "Walk-in",
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
      status: "posted",
      fiscalNumber: `F-OFF-${now}`,
      lastError: "",
      lastResponse: "",
      lastCode: "",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["clients", "invoices"], "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.objectStore("clients").put(client);
      tx.objectStore("invoices").put(invoice);
    });
    const queue = [{ at: now, reason: "offline-invoice" }];
    localStorage.setItem("daftar.syncDirty", "1");
    localStorage.setItem("daftar.syncQueue", JSON.stringify(queue));
    localStorage.setItem("daftar.offlineProof", JSON.stringify({ clientId, invoiceId }));
    const api = await fetch("https://sheikhmahboob.com/pra-api/v1/health").then(
      (r) => r.status,
      () => 0,
    );
    return { clientId, invoiceId, api };
  });

  must(written.api !== 200, `expected API down, got ${written.api}`);
  writeFileSync(resolve(OUT, "written.json"), JSON.stringify(written, null, 2));
  await page.screenshot({ path: resolve(OUT, "queued.png"), fullPage: true });
  await context.close();
  console.log("OFFLINE_DESK_OK", written.clientId, written.invoiceId, "api", written.api);
}

async function phaseDrain() {
  must(EMAIL && PASSWORD, "credentials required for drain");
  const context = await launch();
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`${BASE.replace(/\/?$/, "/")}settings`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000);
  const backup = page.getByRole("link", { name: /^Backup$/ }).or(page.locator('a[href="#backup"]'));
  if (await backup.count()) await backup.first().click().catch(() => {});
  await page.waitForTimeout(500);

  const email = page.locator('input[type="email"]');
  const pass = page.locator('input[type="password"]');
  await email.last().fill(EMAIL);
  await pass.last().fill(PASSWORD);
  const sync = page.getByRole("button", { name: /Sync now/i });
  await sync.click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: resolve(OUT, "after-drain.png"), fullPage: true });

  const state = await page.evaluate(() => ({
    dirty: localStorage.getItem("daftar.syncDirty"),
    queue: localStorage.getItem("daftar.syncQueue"),
    proof: localStorage.getItem("daftar.offlineProof"),
    body: document.body.innerText.slice(0, 1500),
  }));
  writeFileSync(resolve(OUT, "drain-state.json"), JSON.stringify(state, null, 2));
  must(!state.dirty, "sync dirty flag should clear after drain");
  await context.close();
  console.log("QUEUE_DRAIN_OK");
}

const run = PHASE === "drain" ? phaseDrain : phaseDown;
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
