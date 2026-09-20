# Batch 4 done — Desk, print, reports

Agent 4. IMPLEMENT complete. Rebased on `handoff/batch-1-done.md`, `batch-2-done.md`, and `batch-3-done.md`. Did not start Batch 5. Did not rewrite InvoiceEditor.

## 1. What shipped

- One `AppShell` layout for `/` and `/pra`. New `/reports` route: sales book, tax by PCT, buyer ledger, unpaid / PSID gap, failed posts. Excel (all sheets) + per-panel CSV via `lib/reportExport.ts` (did not edit `excel.ts`).
- Desk: posted-sales sparkline, vs-previous-month strip, 15th/18th plates kept, attention jumps kept. `GoLiveChecklist` on empty hosted desk and when the open file still looks like sandbox (`POS 100000` or published sandbox token). No Demo seed.
- Invoice list: text search, date range, buyer filter on top of Batch 3 status/period/bulk post. Mobile table scrolls with sticky USIN.
- CommandJump: routes plus USIN / buyer / client (`personName`, `ntn`). Focus trap. Reports in the jump list.
- Print: practice letterhead, seller CNIC, `cnicAsRegistration` / `personName`, draft vs posted vs failed banner, extras when stored. No QR. No thermal profile.
- Activity: 200-row cap, Load more, CSV with token-like text redacted.
- PIN Lock in the context bar when a PIN exists. Idle timeout (default 15 minutes, `localStorage` `daftar-idle-lock-minutes`, 0 = off). Unlock records activity.
- Error boundary around the page outlet. Offline chip. Field `htmlFor`/`id`. SearchPick `aria-activedescendant`.
- DeskContext: selected-client invoices/purchases/returns/psids; attention uses failed-status + period PSIDs; archived clients hidden in the switcher and attention (open archived file still shows).
- Mobile More: Reports + masters stay reachable.

## 2. Files changed

**New**

- `pra/src/pages/Reports.tsx`
- `pra/src/domain/reports.ts`, `reports.test.ts`
- `pra/src/domain/invoiceList.ts`, `invoiceList.test.ts`
- `pra/src/domain/commandJump.ts`, `commandJump.test.ts`
- `pra/src/domain/print.ts`, `print.test.ts`
- `pra/src/domain/activity.ts`, `activity.test.ts`
- `pra/src/lib/reportExport.ts`
- `pra/src/lib/idleLock.ts`, `idleLock.test.ts`
- `pra/src/hooks/useDeskIdleLock.ts`
- `pra/src/components/ErrorBoundary.tsx`
- `pra/src/components/GoLiveChecklist.tsx`
- `pra/src/components/Sparkline.tsx`

**Owned / rebase**

- `pra/src/App.tsx`
- `pra/src/pages/Desk.tsx`
- `pra/src/pages/Invoices.tsx` (filters + mobile table class only)
- `pra/src/pages/Settings.tsx` (record activity on unlock)
- `pra/src/pages/settings/Security.tsx` (idle minutes)
- `pra/src/components/AppShell.tsx`
- `pra/src/components/CommandJump.tsx`
- `pra/src/components/InvoicePrint.tsx`
- `pra/src/components/Field.tsx`
- `pra/src/components/SearchPick.tsx`
- `pra/src/components/ActivityList.tsx`
- `pra/src/context/DeskContext.tsx`
- `pra/src/index.css`

Did not edit `types.ts`, `db.ts`, `lib/pra.ts`, `lib/backup.ts`, `lib/excel.ts`, `domain/invoices.ts`, `FirstRun.tsx`, `InvoiceEditor.tsx`, `seed.ts`, nginx, or README.

## 3. Public functions / field names (final)

| Name | Module |
|------|--------|
| `salesBook`, `taxByPct`, `buyerLedger`, `failedPosts`, `psidGapRows` | `reports.ts` |
| `previousPeriod`, `periodCompare`, `dailyPostedBills` | `reports.ts` |
| `filterInvoiceList`, `distinctInvoiceBuyers` | `invoiceList.ts` |
| `matchJumpHits`, `DESK_JUMP_ROUTES` | `commandJump.ts` |
| `sellerPrintLines`, `printBanner` | `print.ts` |
| `sanitizeActivityRows`, `scrubActivityText` | `activity.ts` |
| `exportReportWorkbook`, `exportReportCsv` | `reportExport.ts` |
| `idleShouldLock`, `recordDeskActivity`, `readIdleMinutes`, `writeIdleMinutes` | `idleLock.ts` |
| `looksLikeSandboxDemo` | `GoLiveChecklist.tsx` |

Local keys: `daftar-idle-lock-minutes` (`localStorage`, default 15), `daftar-idle-last-activity` (`sessionStorage`). Existing PIN session key unchanged. No Dexie / CONTRACT-DELTA.

## 4. How to prove

From `pra/`:

```bash
npm test
npm run build
```

This run: **135 tests passed**, `tsc -b && vite build` succeeded.

## 5. Leftovers for the next agent

**Batch 5 / ops**

- PWA / offline post queue, thermal print profile, official PRA QR if they document one.
- README still says “or a real fiscal InvoiceNumber” looser than Code `100`/`00` (Batch 1 leftover).
- Production IP whitelist and `/pra-ims` TLS 502 leftovers.

**Not done here (other owners)**

- InvoiceEditor line `name=` / editor skeletons — did not rewrite InvoiceEditor.
- Loading skeletons on Buyers / Items / Returns / PSIDs pages.
- `ledger.psidPaid` still sums `amount` (Batch 3 leftover; `paidAmount` exists).
- `clientReadiness` still says `"PNTN missing"` for CNIC-as-registration (`validate.ts` is Batch 1).
