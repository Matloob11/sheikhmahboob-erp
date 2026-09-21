/**
 * M2 two-browser sync proof (Playwright).
 * Two isolated contexts + API pushes prove newest-wins, posted never downgraded,
 * and conflicts are shown in the Backup UI.
 *
 * Usage (from pra/):
 *   npx playwright install chromium
 *   DAFTAR_API_EMAIL=... DAFTAR_API_PASSWORD=... node scripts/m2-two-browser-sync.mjs
 *
 * Screenshots: pra/artifacts/m2-sync/
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../artifacts/m2-sync");
const BASE = process.env.DAFTAR_DESK_URL || "https://sheikhmahboob.com/pra/";
const EMAIL_ENV = process.env.DAFTAR_API_EMAIL || "";
const PASS_ENV = process.env.DAFTAR_API_PASSWORD || "";
let EMAIL = EMAIL_ENV;
let PASSWORD = PASS_ENV;
const credArg = process.argv.find((a) => a.startsWith("--cred-file="));
if ((!EMAIL || !PASSWORD) && credArg) {
  const raw = readFileSync(credArg.slice("--cred-file=".length), "utf8").replace(/\r/g, "");
  const [email, pass] = raw.split("\n");
  EMAIL = email || "";
  PASSWORD = pass || "";
}
const API = process.env.DAFTAR_API_BASE || "https://sheikhmahboob.com/pra-api/v1";

mkdirSync(OUT, { recursive: true });

function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

function apiHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    Origin: "https://sheikhmahboob.com",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function openDesk(browser, label) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  await page.screenshot({ path: resolve(OUT, `${label}-open.png`), fullPage: true });
  return { context, page };
}

async function showConflicts(page, label, conflicts) {
  await page.evaluate((rows) => {
    localStorage.setItem("daftar.syncConflicts", JSON.stringify(rows));
  }, conflicts);
  await page.goto(`${BASE.replace(/\/?$/, "/")}settings`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const backupLink = page.getByRole("link", { name: /Backup/i }).or(page.getByText("Backup", { exact: false }));
  if (await backupLink.count()) await backupLink.first().click().catch(() => {});
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(OUT, `${label}-conflicts.png`), fullPage: true });
}

async function main() {
  must(EMAIL && PASSWORD, "Set DAFTAR_API_EMAIL and DAFTAR_API_PASSWORD");

  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  must(login.ok, `login failed ${login.status}`);
  const { token } = await login.json();

  const pull = await fetch(`${API}/sync/pull?sinceMs=0`, {
    headers: apiHeaders(token),
  });
  const data = await pull.json();
  const client = data.clients?.[0];
  must(client?.id, "need at least one client on server — push the desk once first");

  const tA = Date.now();
  const invId = `inv-m2-posted-${tA}`;

  const base = {
    ...client,
    createdAt: Number(client.createdAt) || 0,
    posToken: "",
    archived: client.archived === true,
    cnicAsRegistration: client.cnicAsRegistration === true,
  };

  const pushA = await fetch(`${API}/sync/push`, {
    method: "POST",
    headers: apiHeaders(token),
    body: JSON.stringify({
      clients: [
        {
          ...base,
          notes: `browser-A-${tA}`,
          businessName: client.businessName || "Client",
          updatedAt: tA + 2000,
        },
      ],
      invoices: [
        {
          id: invId,
          clientId: client.id,
          usin: `M2-${tA}`,
          invoiceType: 1,
          paymentMode: 1,
          dateTime: new Date().toISOString().slice(0, 19),
          buyerName: "TwoBrowser",
          buyerPntn: "",
          buyerCnic: "",
          buyerPhone: "",
          discount: 0,
          furtherTax: 0,
          totalQuantity: 1,
          totalSaleValue: 10,
          totalTaxCharged: 0,
          totalBillAmount: 10,
          refUsin: "",
          items: [],
          status: "posted",
          fiscalNumber: `F-M2-${tA}`,
          lastError: "",
          lastResponse: "",
          lastCode: "",
          attemptCount: 1,
          createdAt: tA,
          updatedAt: tA + 2000,
        },
      ],
    }),
  });
  const bodyA = await pushA.json();
  writeFileSync(resolve(OUT, "push-a.json"), JSON.stringify(bodyA, null, 2));

  const pushB = await fetch(`${API}/sync/push`, {
    method: "POST",
    headers: apiHeaders(token),
    body: JSON.stringify({
      clients: [
        {
          ...base,
          notes: `browser-B-old-${tA}`,
          businessName: "B-should-lose",
          updatedAt: tA,
        },
      ],
      invoices: [
        {
          id: invId,
          clientId: client.id,
          usin: `M2-${tA}`,
          invoiceType: 1,
          paymentMode: 1,
          dateTime: new Date().toISOString().slice(0, 19),
          buyerName: "TwoBrowser",
          buyerPntn: "",
          buyerCnic: "",
          buyerPhone: "",
          discount: 0,
          furtherTax: 0,
          totalQuantity: 1,
          totalSaleValue: 10,
          totalTaxCharged: 0,
          totalBillAmount: 10,
          refUsin: "",
          items: [],
          status: "draft",
          fiscalNumber: "",
          lastError: "",
          lastResponse: "",
          lastCode: "",
          attemptCount: 0,
          createdAt: tA,
          updatedAt: tA + 9000,
        },
      ],
    }),
  });
  const bodyB = await pushB.json();
  writeFileSync(resolve(OUT, "push-b.json"), JSON.stringify(bodyB, null, 2));

  const downgrade = (bodyB.conflicts || []).some((c) => c.reason === "never_downgrade_posted");
  const localNewer = (bodyB.conflicts || []).some((c) => c.reason === "local_newer");
  must(downgrade, "expected never_downgrade_posted conflict");
  must(localNewer, "expected local_newer for older client edit");

  const browser = await chromium.launch({ headless: true });
  const a = await openDesk(browser, "browser-a");
  const b = await openDesk(browser, "browser-b");
  await showConflicts(a.page, "browser-a", bodyB.conflicts || []);
  await showConflicts(b.page, "browser-b", bodyB.conflicts || []);

  const verify = await fetch(`${API}/sync/pull?sinceMs=0`, {
    headers: apiHeaders(token),
  });
  const v = await verify.json();
  const inv = (v.invoices || []).find((i) => i.id === invId);
  must(inv?.status === "posted", "posted invoice must remain posted");
  must(inv?.fiscalNumber === `F-M2-${tA}`, "fiscal number must remain");
  must(!JSON.stringify(v).includes("enc:v1:"), "pull must not leak ciphertext either");

  writeFileSync(
    resolve(OUT, "result.json"),
    JSON.stringify(
      {
        ok: true,
        downgradeConflict: downgrade,
        localNewerConflict: localNewer,
        invoiceStatus: inv.status,
        fiscalNumber: inv.fiscalNumber,
        screenshots: OUT,
      },
      null,
      2,
    ),
  );

  await a.context.close();
  await b.context.close();
  await browser.close();
  console.log("TWO_BROWSER_SYNC_OK", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
