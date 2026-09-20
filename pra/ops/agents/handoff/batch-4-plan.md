# Batch 4 plan — Desk, print, reports

Agent 4. PLAN only. No `pra/src` edits in this turn.

Surveyed 2026-09-18. `pra/ops/agents/handoff/` had **no** `batch-1-plan.md`, `batch-2-plan.md`, or `batch-3-plan.md` (folder empty). Plans 1–3 were not available to merge against. IMPLEMENT still waits for `IMPLEMENT BATCH 4` **and** `batch-1-done.md`, `batch-2-done.md`, `batch-3-done.md`.

CONTRACT fields (`personName`, `cnicAsRegistration`, `ntn`, invoice `extraTax` / `stWithheld` / `reverseCharge` / `saleType` / `taxpayerType` / `buyerDistrict`, buyer extras) are **read-only** after Batch 2/3. This batch does not add or rename them.

---

## 1. Files you will touch

Owned / new (IMPLEMENT):

| File | Why |
|------|-----|
| `pra/src/App.tsx` | One `AppShell` layout; add `/reports` (and `/pra/reports`) |
| `pra/src/pages/Desk.tsx` | Sparklines, period compare, go-live checklist on empty hosted desk |
| `pra/src/pages/Reports.tsx` | **New.** Sales book, tax by PCT, buyer ledger, unpaid / PSID gap, failed posts |
| `pra/src/domain/reports.ts` | **New.** Pure aggregations + period compare |
| `pra/src/domain/reports.test.ts` | **New.** |
| `pra/src/domain/invoiceList.ts` | **New.** List filter (text / dates / buyer / status / period) so `Invoices.tsx` stays thin |
| `pra/src/domain/invoiceList.test.ts` | **New.** |
| `pra/src/lib/reportExport.ts` | **New.** CSV + xlsx download, same ExcelJS pattern as `lib/excel.ts` — **do not edit** `excel.ts` |
| `pra/src/lib/idleLock.ts` | **New.** Last-activity + idle minutes; calls existing `lockPractice()` |
| `pra/src/lib/idleLock.test.ts` | **New.** |
| `pra/src/components/AppShell.tsx` | Reports nav, real Lock, offline chip, idle watcher |
| `pra/src/components/CommandJump.tsx` | Entity search (USIN / buyer / client) + focus trap |
| `pra/src/components/InvoicePrint.tsx` | Practice letterhead, seller CNIC / `cnicAsRegistration` / `personName`, draft vs posted |
| `pra/src/components/Field.tsx` | `htmlFor` / `id` via `useId` |
| `pra/src/components/SearchPick.tsx` | `aria-activedescendant` on the active option |
| `pra/src/components/ErrorBoundary.tsx` | **New.** Wrap routes in `App.tsx` |
| `pra/src/components/GoLiveChecklist.tsx` | **New.** Token → whitelist email → first post. No Demo seed |
| `pra/src/components/Sparkline.tsx` | **New.** Tiny SVG, no chart npm package |
| `pra/src/components/ActivityList.tsx` | Cap / Load more + CSV (no tokens in cells) |
| `pra/src/pages/Settings.tsx` | Activity export button; idle watcher host if not only in shell |
| `pra/src/pages/settings/Security.tsx` | Idle-timeout minutes control (localStorage, not Dexie) |
| `pra/src/context/DeskContext.tsx` | Bound Dexie reads (no unbounded `invoices.toArray()`); events page size |
| `pra/src/index.css` | Reports / print banners / mobile invoice table / offline chip / lock button |

Rebase after done files 1–3 (same files, earlier batch ships first):

| File | After | Change only |
|------|--------|-------------|
| `pra/src/pages/Invoices.tsx` | `batch-3-done.md` | Text search, date range, buyer filter; mobile table class. **No editor / bulk post rewrite** |
| `pra/src/pages/Buyers.tsx`, `Items.tsx` | `batch-2-done.md` | Loading `Skeleton` if still missing |
| `pra/src/pages/InvoiceEditor.tsx`, `Returns.tsx`, `Psids.tsx` | `batch-3-done.md` | Loading `Skeleton`; line inputs `name` / `id` if Batch 3 left them unnamed. **No post/retry/payload work** |

Do **not** touch: `types.ts`, `db.ts`, `lib/pra.ts`, `lib/backup.ts`, `lib/excel.ts`, `domain/invoices.ts`, `domain/clients.ts`, `lib/seed.ts`, `shouldSeedDemoClient`, nginx, deploy.

---

## 2. Exact functions / bugs

### Reports

`domain/reports.ts` (period = working month, one client):

- `salesBook(invoices, clientId, period)` — all statuses; columns USIN, dateTime, buyer, type, status, sale, tax, bill, fiscal, lastCode (not token).
- `taxByPct(invoices, clientId, period)` — posted lines grouped by `pctCode`: qty, sale, tax, furtherTax.
- `buyerLedger(invoices, clientId, period)` — by `buyerPntn` or `buyerName` or `"walk-in"`: count, sale, tax.
- `psidGapRows(ledger, psids)` — unpaid / planned / generated rows + `psidGap` from existing `computeFileLedger`.
- `failedPosts(invoices, clientId, period)` — `status === "failed"`; include `lastMessage` / `lastCode` only.
- `previousPeriod(period)` — `YYYY-MM` minus one month (no helper in `ids.ts` today).
- `periodCompare(current: FileLedger, previous: FileLedger)` — deltas for saleValue, outputTax, inputTax, netPayable, psidGap, saleCount.

`lib/reportExport.ts`:

- `exportReportWorkbook(name, sheets)` — ExcelJS `Workbook` + header row, same download blob pattern as `excel.ts`.
- `exportReportCsv(filename, headers, rows)` — UTF-8 CSV, no tokens.

`pages/Reports.tsx`: five panels, period from desk, Export Excel / Export CSV. Link from Desk + rail.

### Desk

Keep KPI row, 15th/18th plates, attention jumps, FirstRun when `clients.length === 0`.

Add:

- SVG sparkline of posted `totalBillAmount` (or daily sale) in the working period.
- Period-compare strip: this month vs `previousPeriod(period)` using two `computeFileLedger` calls.
- Mount `GoLiveChecklist` under FirstRun on empty desk, and a compact panel when the open file still looks like sandbox/demo (POS `100000` or published sandbox token) — copy only, **no** `sampleSandboxFile()` in production.

### Invoice list (after Batch 3)

`filterInvoiceList(invoices, { clientId, status, scope, period, query, from, to, buyer })`:

- `query` matches USIN, fiscal, buyer name, buyer PNTN (case-insensitive).
- `from` / `to` on `dateTime` (`YYYY-MM-DD` prefix).
- `buyer` exact buyer name or PNTN from a small select of distinct buyers in the loaded set.

Today `Invoices.tsx` has status + period/all-months only.

### Command jump

Extract `matchJumpHits({ query, routes, invoices, buyers, clients })`:

- Routes stay (add Reports).
- Clients: `businessName`, `pntn`, `ntn`, `personName` if present.
- Buyers: `name`, `pntn`, `cnic` for the **selected** client (or all if cheap).
- Invoices: `usin`, `fiscalNumber` — selected client, recent first, cap ~20 hits.

On pick: `chooseClient` if needed, then `sectionPath`.

Focus trap: Tab cycles inside the dialog; Escape / scrim closes; restore focus to the opener (or `document.body` if none).

Dexie: search selected-client invoices via `where("clientId")`, not `toArray()` of the whole table.

### Print

`sellerPrintLines(client, firmName)`:

- Letterhead: `settings.firmName` (“Prepared by …”) above seller lockup.
- Seller: `businessName`, `personName` if set, PNTN, CNIC.
- If `cnicAsRegistration` and 13-digit CNIC: label “Registration (CNIC)”, not “No PNTN”.
- Banner: **DRAFT / VALIDATED** watermark vs **POSTED** + fiscal; failed = “Not accepted by PRA”.
- Optional print extras if Batch 3 stored them: `saleType`, `furtherTax` (already), `extraTax` / `stWithheld` only when > 0.

`printInvoice()` stays `window.print()`.

**Skip QR** — no official PRA QR spec; will not invent one.  
**Skip thermal** unless a cheap `@media print` width tweak is free; not a must-ship.

### Activity

- DeskContext events: raise `limit(40)` → `limit(200)`.
- ActivityList: “Load more” (`offset` + another 200 from Dexie `orderBy("createdAt").reverse()`).
- CSV: `createdAt`, `kind`, `title`, `detail`, `clientId`. Strip anything that looks like a bearer token (`Authorization`, 40+ hex/base64 blobs). Never write `posToken`.

### PIN / idle

- Replace AppShell `lock-slot` placeholder with a **Lock** button when `hasPracticePin(settings)`. Hidden if no PIN.
- `idleLock.ts`: `IDLE_MINUTES_KEY = "daftar-idle-lock-minutes"` in `localStorage` (default **15**). `recordDeskActivity()`, `idleShouldLock(lastMs, nowMs, minutes)`. Pointer/keydown/visibility → activity. Idle → `lockPractice()`.
- Security section: number field “Lock after (minutes)”, 0 = off. **No** `Settings` / Dexie field unless Batch 2 already added `idleLockMinutes` (then prefer that; no CONTRACT-DELTA from this batch).

### Loading / errors / offline

- `ErrorBoundary` around `<Outlet />` (or the single `AppShell` tree). Reset on path change.
- `navigator.onLine` chip in the context bar (“Offline — posts wait until the network returns”). Not a queue.
- Skeletons: Desk already has them. After 2/3 done, add `Skeleton variant="table"` on buyers/items/psids/returns/editor while `useLive` / invoice hydrate is empty **and** not a true empty file.

### A11y

- `Field` / `TextInput` / `SelectField` / `AreaField`: `const id = useId()`; label `htmlFor={id}`; control `id` (caller `id` wins).
- SearchPick: option ids `${listId}-${index}`; combobox `aria-activedescendant` when open.
- Invoice lines: `name={`line-${index}-qty`}` etc. after Batch 3.

### Mobile

- More panel already reaches Clients / Buyers / Items / PSID / Settings. Add **Reports**. Keep masters reachable.
- CSS: `.table-wrap.invoice-table` stacks or allows horizontal scroll with sticky USIN on small viewports. Do not drop bulk-post toolbar.

### One AppShell

Today `App.tsx` mounts two layout routes (`/pra` and `/` each with `<AppShell />`). Collapse to **one** parent:

```tsx
<Route element={<AppShell />}>
  <Route path="pra">{deskChildRoutes("/pra")}</Route>
  {deskChildRoutes("/")}
</Route>
```

Keep `sectionPath` / hosted `/pra` behavior. Add `reports` to `deskChildRoutes`. Wrap with `ErrorBoundary`.

### DeskContext bound reads

`db.invoices.toArray()` / purchases / psids load the whole cabinet.

- Selected client: `where("clientId").equals(id)`.
- Attention: `invoices.where("status").equals("failed")` + `psids` for `workingPeriod` (both indexed in v3). Do not load every historic invoice for the desk KPIs.
- `ready` stays settings + clients; list pages that need “all months” query Dexie themselves or pass a scope flag — Reports / Desk use client+period only.

---

## 3. Schema / API you will add

**No Dexie version bump. No new tables. No `types.ts` / `db.ts` edits.**

Use CONTRACT fields after Batch 2 if present (optional chaining):

- Client: `personName`, `cnicAsRegistration`, `ntn`, existing `cnic` / `pntn` / `businessName`.
- Invoice print/report: `extraTax`, `stWithheld`, `saleType`, `buyerDistrict` if set.
- Buyer search: `buyerType` if present.

Local-only (not CONTRACT):

| Key | Store | Default |
|-----|--------|---------|
| `daftar-idle-lock-minutes` | `localStorage` | `15` |
| `daftar-idle-last-activity` | `sessionStorage` | now |

Existing PIN API unchanged: `hasPracticePin`, `lockPractice`, `unlockPractice`, `subscribePracticeLock`, session key `daftar-practice-unlock`.

New public functions (final names):

```
salesBook, taxByPct, buyerLedger, psidGapRows, failedPosts,
previousPeriod, periodCompare,
filterInvoiceList, matchJumpHits,
sellerPrintLines, exportReportWorkbook, exportReportCsv,
idleShouldLock, recordDeskActivity, readIdleMinutes, writeIdleMinutes,
sanitizeActivityRows
```

If Batch 2 adds `Settings.idleLockMinutes`, prefer it and drop the localStorage minutes key. This plan does **not** propose a CONTRACT-DELTA.

---

## 4. Tests you will add

| File | Cases |
|------|--------|
| `domain/reports.test.ts` | Sales book period/client isolation; tax by PCT sums lines; buyer ledger walk-in vs PNTN; failed posts exclude posted; `previousPeriod("2026-01") === "2025-12"`; period compare deltas |
| `domain/invoiceList.test.ts` | USIN / fiscal / buyer text; date range; status + period still work |
| `lib/idleLock.test.ts` | Lock after N minutes; 0 minutes never locks; activity resets |
| `domain/reports.test.ts` or print helper | `sellerPrintLines`: CNIC + `cnicAsRegistration`; `personName`; draft vs posted banner flag |
| Command helper | `matchJumpHits` finds USIN and client PNTN; empty query returns routes |
| Activity sanitize | Token-like `detail` stripped |

Prove after IMPLEMENT (not now): `cd pra && npm test && npm run build`.

No browser-only tests required. No IRIS / GetData tests.

---

## 5. What you will not do

- Implement before `IMPLEMENT BATCH 4` and done files 1–3.
- Batches 1, 2, 3, or 5.
- Edit `pra/src` in PLAN.
- Node server, PWA, nginx, deploy, commit.
- Scrape IRIS, invent PSIDs, file a return, add GetData.
- Seed Ahmad Traders / Demo in hosted prod; do not change `shouldSeedDemoClient`.
- Fight Batch 3 on InvoiceEditor (payload, post lock, FurtherTax, bulk post).
- Edit `lib/excel.ts` columns or `lib/backup.ts` crypto.
- Bump Dexie or backup export version.
- Fake a PRA QR code.
- Log or print POS tokens / PIN / IRIS passwords.
- Load every invoice into DeskContext if a `clientId` query exists.
- Dual AppShell left in place.

---

## 6. Blocked / needs other batch

| Need | Who | If missing at IMPLEMENT |
|------|-----|-------------------------|
| `batch-1-done.md` | Agent 1 | **Do not start.** Integrity / `inFlight` / PRA success must exist first |
| `batch-2-done.md` | Agent 2 | Wait. Print/search use `personName` / `cnicAsRegistration` / `ntn` with `?.` if still absent |
| `batch-3-done.md` | Agent 3 | Wait. Then rebase `Invoices.tsx` filters only. Line `name=` if editor omitted them |
| `batch-*-plan.md` 1–3 | — | **Absent at PLAN time.** Re-read at IMPLEMENT; no assumed columns or settings keys |
| `idleLockMinutes` on Settings | Agent 2 (optional) | Use `localStorage` minutes; no schema from Batch 4 |
| FirstRun step copy | Agent 2 owns `FirstRun.tsx` | Do not rewrite FirstRun. `GoLiveChecklist` on Desk only |
| Attention `cnicAsRegistration` | Agent 1 `clientReadiness` | Do not edit `ledger.ts` / `validate.ts`. Print/checklist only |
| Invoice header extras on print | Agent 3 | Show only if fields exist and non-empty |
| Backup v5 / new tables | Agent 2 | Reports do not export `clientPlaces` / banks / POS devices |

Leftovers for Batch 5 (not this batch): PWA offline queue, thermal profile, official QR if PRA documents one, hosted ops.
