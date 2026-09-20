# UI batch 1 — done (Claude Code, 2026-09-20)

Ran in parallel with Batch 6 Phase 2. Read this before touching the files below so the
two streams do not overwrite each other.

## What shipped

1. **Today — cross-client work queue** (`/today`, first item in the rail and the mobile bar).
   One row per active client with the next step in the monthly chain:
   fix failed → post → pay PSID → file return → done (`setup` when the file cannot post yet).
   Stage pills with counts, search by name or PNTN, 50 rows per page, days left to the
   15th and 18th, late marker, "Open" switches client and jumps to the right section.
   Loads only unposted invoices plus this period's PSIDs and returns — never the posted
   history — and groups in one pass per table (500 clients / 5,000 open invoices < 250 ms,
   covered by a test).
2. **Confirm dialog** focuses Cancel and traps Tab over every focusable element, so Enter
   no longer triggers Delete / Post live.
3. **Phones**: invoice line table and the Today table turn into one card per row below
   720px (`data-label` on each cell); 44px touch targets on coarse pointers; the PCT input
   got its missing `aria-label`; mobile bar is 5 columns.
4. **POS**: "Print receipt" after a posted sale (hidden `InvoicePrint` in `.pos-receipt`,
   page chrome hidden in print via `.pos-page`).
5. **Thermal print**: named `@page thermal { size: 80mm auto }`, four-column receipt
   (item, qty, tax, total), class removed on `afterprint` instead of an 800 ms timer.
6. **Plain language**: go-live checklist now points at the real place POS IDs come from
   (`reg.pra.punjab.gov.pk` → Registration → POS Client Registration, IP on the Pos Details
   tab); bulk-post and POS confirm texts lost "PostData", "in-flight", "README".

## Files

New: `src/domain/today.ts`, `src/domain/today.test.ts`, `src/pages/Today.tsx`.

Edited: `src/App.tsx` (route), `src/components/AppShell.tsx` (nav + icon),
`src/components/Confirm.tsx`, `src/components/InvoicePrint.tsx` (`printInvoice` only),
`src/components/GoLiveChecklist.tsx`, `src/smc-theme.css` (one appended block, nothing above
it changed), and small text/markup edits in `src/pages/InvoiceEditor.tsx` (10 `data-label`
attributes on the line table, one notice string), `src/pages/PosSale.tsx` (import, root
class, Print receipt button, receipt block, confirm body), `src/pages/Invoices.tsx`
(two strings).

Not touched: `lib/pra.ts`, `domain/invoices.ts`, `db.ts`, `types.ts`, posting logic,
`index.css`.

## Proof

`npx vitest run src/domain/today.test.ts` → 9 passed. `tsc -b` is clean for every file
above. At the time of writing the full suite had 1 failing test
(`invoices.test.ts > inFlight sweep and claim`) and one unused `postingRef` in
`PosSale.tsx`; both belong to the Phase 2 work in progress, not to this batch.

## Left for a later UI batch

- Clients table: status columns, sort, recents/pins in the switcher, combobox keyboard pattern.
- Merge `index.css` + `smc-theme.css` into one token sheet; delete the dead dark block and
  the 16 unused classes; replace hard-coded `#fff` with `var(--surface)`.
- Split `Clients.tsx` and `InvoiceEditor.tsx` per tab / per step.
- Field-level errors (`aria-invalid`, `aria-describedby`), Enter / arrow keys in the line grid.
- QR code on the print: blocked until the PRA manual's required QR content is confirmed.
- Urdu strings file.
- Not browser-tested yet: the 80mm `@page` rule and the phone card layout need one real
  print and one real phone check.

## Follow-up after Phase 2

Phase 2 added invoice status `unknown` (sent, no answer). Today now loads it, counts it in a new
"Unclear" column and ranks it first inside the `fix` stage ("Check N unclear invoice on IRIS",
opens `/invoices?status=unknown&scope=all`). Stage pill renamed to "Check or fix". Full suite after this change: see the run in the chat log.
