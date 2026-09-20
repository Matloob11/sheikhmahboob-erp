# Batch 1 done — Integrity

Agent 1. IMPLEMENT complete.

## 1. What shipped

- `removeClientFile(..., true)` also deletes buyers, items, and events (same transaction as invoices / purchases / returns / PSIDs).
- `findDuplicateUsin` uses `[clientId+usin]`. `withTotals` trims USIN. Validate / submit / import refuse a second row.
- `markReturn` reuses the existing `clientId+period` row. `pickReturnForPeriod` / `returnForPeriod` keep the latest `updatedAt`.
- `sweepHungInFlight()` clears `inFlight` on non-posted rows. Manual `clearInvoiceInFlight` unchanged. **Call site still Batch 2** (`ensureSeed`).
- `claimInvoiceForPost` sets `inFlight` inside a Dexie `rw` transaction; the second tab cannot both pass `submitGate` and post.
- `submitInvoice` never rethrows. Network/error returns `SubmitInvoiceResult` with `inFlight: false`.
- PRA `ok` only on Code `100` / `00`. Sandbox `100` + `Not Available` still succeeds. Lone fiscal in an error body is not posted. Duplicate without a success code stays `failed` + `usin-exists`.
- Excel `salesHeaderIndex` reads column 1 (`USIN`). Optional `HeaderDiscount` is parsed and applied on import. Annex C emits **one row per line**.
- `withTotals` keeps header `furtherTax` = line sum.
- `clientReadiness` blocks production + published sandbox token (`Sandbox token on a production file`).
- `importBackup` throws (preview + `applyBackup` only). `applyBackup` calls `lockPractice()` when the written settings have a PIN.

## 2. Files changed

- `pra/src/domain/invoices.ts`
- `pra/src/domain/invoices.test.ts`
- `pra/src/domain/clients.ts` (cascade only)
- `pra/src/domain/clients.test.ts` (new)
- `pra/src/domain/returns.ts` (unique period only)
- `pra/src/domain/returns.test.ts` (new)
- `pra/src/domain/validate.ts`
- `pra/src/domain/validate.test.ts`
- `pra/src/domain/ledger.ts` (`returnForPeriod` latest-updatedAt; readiness still via `validate`)
- `pra/src/domain/ledger.test.ts`
- `pra/src/lib/pra.ts` (success map only)
- `pra/src/lib/pra.test.ts`
- `pra/src/lib/excel.ts` (bugs only)
- `pra/src/lib/excel.test.ts` (new)
- `pra/src/lib/backup.ts` (`importBackup` + restore lock)
- `pra/src/lib/backup.test.ts`

Did not edit `db.ts`, `types.ts`, InvoiceEditor, AppShell, Desk, seed, nginx, or README.

## 3. Public functions / field names (final)

| Name | Module |
|------|--------|
| `findDuplicateUsin` | `invoices.ts` (index lookup) |
| `withTotals` | `invoices.ts` (exported) |
| `claimInvoiceForPost` | `invoices.ts` |
| `sweepHungInFlight` | `invoices.ts` |
| `pickReturnForPeriod` | `returns.ts` |
| `findReturnForPeriod` | `returns.ts` |
| `annexCRows` | `excel.ts` |
| `salesHeaderIndex` | `excel.ts` |
| `ImportedSaleRow.HeaderDiscount?` | `excel.ts` |
| `importBackup` | `backup.ts` — throws `Use previewBackup + applyBackup after confirm.` |

No new schema fields. No Dexie version bump. `shouldSeedDemoClient` unchanged.

## 4. How to prove

From `pra/`:

```bash
npm test
npm run build
```

This run: **99 tests passed**, `tsc -b && vite build` succeeded.

## 5. Leftovers for the next agent

**Batch 2**

- Call `await sweepHungInFlight()` at the start of `ensureSeed` (every launch, not only first-run).
- Optional unique `&[clientId+usin]` and `&[clientId+period]` on the next schema bump.
- Extend `removeClientFile` to `clientPlaces` / `clientBanks` / `clientPosDevices` when those tables exist.

**Batch 3**

- Add `HeaderDiscount` to the downloadable sales template.
- Returns UI can consume `annexCRows` (do not collapse back to first-line PCT).

**Batch 5**

- README leftover “or a real fiscal InvoiceNumber” is looser than Code `100`/`00`. Align docs.
