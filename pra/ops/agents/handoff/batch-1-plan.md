# Batch 1 plan — Integrity

Agent 1. PLAN only. No `pra/src` edits in this mode.

## 1. Files I will touch (IMPLEMENT)

Owned / allowed:

| File | Why |
|------|-----|
| `pra/src/domain/clients.ts` | Cascade `removeClientFile` to buyers, items, events |
| `pra/src/domain/invoices.ts` | USIN index lookup, transactional inFlight claim, `submitInvoice` one return path, hung-lock sweep helper, Excel header discount on import, export `withTotals` |
| `pra/src/domain/invoices.test.ts` | Lock / USIN / sweep / network-return / furtherTax tests |
| `pra/src/domain/returns.ts` | `markReturn` reuse the existing `clientId+period` row |
| `pra/src/domain/validate.ts` | `clientReadiness` sandbox-token-on-production blocker |
| `pra/src/domain/validate.test.ts` | Readiness + existing validate cases |
| `pra/src/domain/ledger.ts` | `returnForPeriod` must not take an arbitrary first duplicate (integrity must-fix #3) |
| `pra/src/lib/pra.ts` | Success only on Code `100` / `00` |
| `pra/src/lib/pra.test.ts` | Success-code and fiscal-in-error cases |
| `pra/src/lib/excel.ts` | Column-0 `indexOf`; Annex C one row per line; parse optional `HeaderDiscount` |
| `pra/src/lib/excel.test.ts` | **New** — column 0, header discount, Annex C expansion |
| `pra/src/lib/backup.ts` | Remove preview-less `importBackup`; lock practice after restore if PIN present |
| `pra/src/lib/backup.test.ts` | Restore lock + no public preview-less import |

New test files (not owned by later batches):

- `pra/src/domain/clients.test.ts` — cascade
- `pra/src/domain/returns.test.ts` — unique period / markReturn

## 2. Exact functions / bugs

### Cascade (`removeClientFile`)

Today deletes clients, invoices, purchases, returns, psids only. Orphans `buyers`, `items`, `events`.

Fix: load those three by `clientId`, include their tables in the same `rw` transaction, `bulkDelete`. Child tables from CONTRACT (`clientPlaces`, `clientBanks`, `clientPosDevices`) do **not** exist yet — Batch 2 extends the cascade when it adds them.

### USIN uniqueness

`[clientId+usin]` already exists on Dexie v2/v3 (`db.ts`). `findDuplicateUsin` still scans every invoice for the client.

Fix in domain only (cannot edit `db.ts`):

- `findDuplicateUsin` → `db.invoices.where("[clientId+usin]").equals([clientId, usin.trim()])`
- Trim `usin` in `withTotals` so the index key matches
- Same check on `saveInvoiceDraft`, `validateInvoiceDraft`, `submitInvoice`, `importSalesFile`
- Do **not** bump Dexie to `&[clientId+usin]` here — that is a `db.ts` unique-flag change for Batch 2

### Return uniqueness

`returns` already has `[clientId+period]`. `markReturn` still `put`s a **new** id when `existing` is omitted, so a second row is possible. `returnForPeriod` (`ledger.ts`) uses `.find` (first in array order).

Fix:

- `findReturnForPeriod(clientId, period)` in `returns.ts`: index lookup; if several rows exist, keep the latest `updatedAt`
- `markReturn` always loads that row and updates it (or creates one if none)
- `returnForPeriod` uses the same pick rule so Desk cannot show the wrong filing status

### Hung `inFlight`

No sweep on `ensureSeed`. Crash / closed tab leaves `inFlight: true`. Manual `clearInvoiceInFlight` already exists (keep it).

Fix:

- New `sweepHungInFlight(now = Date.now())` in `invoices.ts`: clear `inFlight` on every non-posted row (startup recovery). Posted rows stay locked.
- **Call site is Batch 2:** one line at the top of `ensureSeed` in `db.ts` (that file is not mine). Until then the function exists and is tested; hosted app will not auto-sweep.

### Cross-tab post race

`submitInvoice` reads, then writes `inFlight`, then posts. Two tabs can both pass `submitGate`.

Fix: `claimInvoiceForPost(id)` inside `db.transaction("rw", db.invoices, …)`:

1. `get` stored row
2. Run `submitGate` on **stored** row
3. If not allowed, return that result (no post)
4. Else `put` `{ …stored, inFlight: true }` and return the claimed row

`submitInvoice` only calls `postInvoice` after the claim commits. IndexedDB serializes overlapping writes on the same store; the second tab sees `inFlight`.

### `submitInvoice` error path

`catch` persists `status: "failed"`, `inFlight: false`, then **rethrows**. Editor and batch already have two styles.

Fix: **never rethrow**. Return `SubmitInvoiceResult` (`errors: [message]`, `inFlight: false`, no `result`). `submitInvoiceBatch` can drop its extra `catch` for this path or keep it as a belt.

### PRA success (`mapPraOutcome` / `interpretPraPost`)

Today: `if (successCode || realFiscal) ok = true`. A fiscal inside an error body (or duplicate + fiscal, no success code) marks posted.

CONTRACT / this batch:

- `ok === true` only when Code is `100` or `00`
- Sandbox `Code 100` + `InvoiceNumber: "Not Available"` stays success (existing tests / README sandbox rule)
- `"Not Available"` alone is not success (already true)
- Lone real fiscal in an error / empty code is **not** success
- Duplicate text → `alreadyExists: true`, `ok` only if success code also present
- `applyPraResult`: mark `posted` only when `result.ok`. Duplicate without success code stays `failed` + `usin-exists` gate (do not promote on fiscal alone)

Existing test *“treats a duplicate that returns a real fiscal number as posted”* will be **rewritten** to expect `ok: false`, `alreadyExists: true`.

Do not change `postInvoice` transport / proxy fallback.

### Excel column 0

`headers[col] = …` is 1-based (ExcelJS). `findIndex` is 0-based. `found > 0` **drops column 1** (`USIN` on the template). `indexOf` must accept `found >= 0` and map to the Excel column number (`found` is already the 1-based index if we keep assigning `headers[col]`). Implementation: search the sparse 1-based array with a loop, or `findIndex` then treat `0` as missing and `>= 1` as valid. Do not use `found > 0` as “found”.

### Excel header discount

`importSalesFile` always calls `totalsFromItems(items, 0)`.

Fix:

- Parse optional `HeaderDiscount` on each sheet row
- Grouped invoice uses the first line’s `HeaderDiscount` (default `0`) as `invoice.discount` and `totalsFromItems(items, headerDiscount)`
- Line `Discount` stays on the line
- Do not redesign the template (Batch 3 may add the column to the downloadable sheet)

### Annex C

`firstPct` / `firstRate` emit one HS/rate from `items[0]`.

Fix: export `annexCRows(invoice)` — **one working-paper row per line** (PCT, rate, that line’s sale/tax/further). `exportReturnPack` maps those rows. No Returns.tsx rewrite.

### `Invoice.furtherTax`

`withTotals` already spreads `totalsFromItems`, which sums line `furtherTax`. Export `withTotals` and test: header `furtherTax` equals the line sum after sync, including import/save paths that used to pass stale header values.

### `clientReadiness`

`validateClient` already rejects published `PRA_SANDBOX_TOKEN` on production. Desk attention does not.

Add reason: `Sandbox token on a production file` (do not interpolate the token). `attentionJump` already matches `"token"` → Clients.

### Deprecated `importBackup`

No callers. It is still a public preview-less replace.

Remove the export (or replace the body with `throw new Error("Use previewBackup + applyBackup after confirm.")`). Settings UI already previews then `applyBackup`.

### Restore lock

`Backup.tsx` already `lockPractice()` after apply if PIN present. Domain must do it too so any caller is safe: after `applyBackup` commits, if `hasPracticePin(written settings)` call `lockPractice()`.

## 3. Schema / API I will add

No new Client/Invoice fields. No new tables. No Dexie version bump (Batch 2 owns `db.ts`).

Public functions (additive):

| Name | Module | Role |
|------|--------|------|
| `sweepHungInFlight` | `invoices.ts` | Startup recovery; Batch 2 must call from `ensureSeed` |
| `claimInvoiceForPost` | `invoices.ts` | Transactional send lock (may stay unexported if tests import via submit) |
| `withTotals` | `invoices.ts` | Exported for tests / import sync |
| `findReturnForPeriod` | `returns.ts` | Canonical unique-period read |
| `annexCRows` | `excel.ts` | Per-line Annex C data |
| `ImportedSaleRow.HeaderDiscount?` | `excel.ts` | Optional parse field only |

CONTRACT: no delta. Unique USIN / unique return enforced in domain against existing compound indexes.

`shouldSeedDemoClient` unchanged.

## 4. Tests I will add

| Case | Where |
|------|--------|
| `removeClientFile(id, true)` deletes buyers, items, events; invoices still go | `clients.test.ts` |
| Two invoices same client+USIN: `findDuplicateUsin` / validate / save | `invoices.test.ts` |
| `markReturn` twice same period → one row; second updates status | `returns.test.ts` |
| `returnForPeriod` with two rows picks latest `updatedAt` | `returns.test.ts` or `ledger.test.ts` |
| `sweepHungInFlight` clears draft/validated/failed locks, not posted | `invoices.test.ts` |
| Second `claimInvoiceForPost` / `submitInvoice` while inFlight does not post | `invoices.test.ts` (mock `postInvoice`) |
| `submitInvoice` network failure returns result, does not throw; `inFlight` false | `invoices.test.ts` |
| Code `100` / `00` success; `100` + Not Available sandbox success | `pra.test.ts` (keep) |
| Code `101` + real fiscal in body → not `ok` | `pra.test.ts` |
| Duplicate + fiscal, no success code → not posted | `pra.test.ts` (replace old test) |
| `indexOf` reads `USIN` in column 1 | `excel.test.ts` |
| Import + `HeaderDiscount` → `invoice.discount` and bill amount | `excel.test.ts` / `invoices.test.ts` |
| Annex C two lines → two HS rows | `excel.test.ts` |
| `withTotals` header `furtherTax` = line sum | `invoices.test.ts` |
| Production + `PRA_SANDBOX_TOKEN` in `clientReadiness` | `validate.test.ts` |
| `importBackup` not a usable public path; `applyBackup` locks when PIN hash/salt present | `backup.test.ts` |

`npm test` and `npm run build` from `pra/` on IMPLEMENT.

## 5. What I will not do

- Change `shouldSeedDemoClient` or seed Ahmad Traders / real taxpayers
- Add CONTRACT extra fields or Dexie v4+ tables
- Edit `postInvoice` request/parse/fallback (success map only)
- Edit InvoiceEditor, Invoices, AppShell, Desk, Settings UI
- Edit `db.ts`, `types.ts`, `App.tsx` (call-site for sweep is Batch 2)
- IRIS login, GetData, official PSID, portal file
- Deploy, commit, `push-pra.sh`
- Batches 2–5

## 6. Blocked / needs other batch

| Need | Who |
|------|-----|
| `await sweepHungInFlight()` at the start of `ensureSeed` (every launch, not only first-run) | **Batch 2** (`db.ts`) |
| Optional Dexie unique `&[clientId+usin]` and `&[clientId+period]` on the next schema bump | **Batch 2** (`db.ts`) |
| Extend `removeClientFile` to `clientPlaces` / `clientBanks` / `clientPosDevices` when those tables exist | **Batch 2** |
| Sales template column `HeaderDiscount` on the downloadable xlsx; Returns UI for per-line Annex C | **Batch 3** |
| README line “or a real fiscal InvoiceNumber” is looser than this batch; align leftovers to Code `100`/`00` only | **Batch 5** (`pra/README.md`) |

UI already has Clear send lock and backup preview; no Batch 4 UI required for these fixes.
