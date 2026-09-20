# Batch 1 — Integrity (Agent 1)

You are **Agent 1** for Daftar (`pra/`).

## Read first (in this order)

1. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\PROTOCOL.md`
2. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\CONTRACT.md`
3. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\README.md`
4. `pra/src/domain/invoices.ts`
5. `pra/src/domain/clients.ts`
6. `pra/src/domain/returns.ts`
7. `pra/src/lib/pra.ts`
8. `pra/src/lib/excel.ts`
9. `pra/src/lib/backup.ts`
10. `pra/src/db.ts`
11. `pra/src/lib/seed.ts`
12. Existing tests next to those files

## Your job

Fix data loss, double-post, and wrong PRA/Excel results. No new product features. No new screens.

## Must fix

1. `removeClientFile` — also delete `buyers`, `items`, `events` (and later child tables if they already exist).
2. USIN uniqueness — use `[clientId+usin]`; stop full-table scan in `findDuplicateUsin` if possible.
3. Return uniqueness — one row per `clientId+period`; `markReturn` must not add a second row; `returnForPeriod` must not silently pick the wrong first row.
4. Hung `inFlight` — sweep on `ensureSeed` / app start; keep a manual unlock path.
5. Cross-tab post race — `inFlight` must be safe enough that two tabs cannot both pass `submitGate` and both post.
6. `submitInvoice` — network/error persist must not leave callers with a confusing rethrow; pick one consistent return path and test it.
7. `mapPraOutcome` / `interpretPraPost` — success only on Code `100` or `00` (plus existing sandbox `"Not Available"` + success code rules in README). Do **not** mark success from a random fiscal inside an error body.
8. `parseSalesWorkbook` — `indexOf` / column 0 must match the first column.
9. Excel import — apply header discount (`totalsFromItems` must not force `0` if the sheet has a header discount).
10. Annex C export/view data — all invoice lines, not only the first line’s PCT (fix the data function if it lives in excel/returns; UI rewrite is Batch 4/3).
11. `Invoice.furtherTax` header must stay in sync with line sum (`withTotals`).
12. `clientReadiness` — production client + sandbox token is a blocker.
13. Deprecated `importBackup` — do not leave a preview-less public path.
14. After backup restore, if a practice PIN exists, desk must be locked.
15. Tests for: cascade, USIN dup, return unique, inFlight sweep, PRA success codes, excel column 0, header discount, sandbox token on production.

## Do not

- Change `shouldSeedDemoClient`
- Add schema fields (that is Batch 2) unless a tiny index flag is required for uniqueness
- Touch InvoiceEditor / AppShell / Desk UI except if a one-line unlock call already exists
- Deploy, commit, scrape IRIS

## PLAN output

Write `pra/ops/agents/handoff/batch-1-plan.md` then STOP.

## IMPLEMENT

Only after message contains `IMPLEMENT BATCH 1`.  
Write `pra/ops/agents/handoff/batch-1-done.md`.  
`cd pra && npm test && npm run build`
