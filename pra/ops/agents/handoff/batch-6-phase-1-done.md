# Batch 6 — Phase 1 done

Correctness bugs that put a wrong number on a tax invoice or lose data.

## What changed

1. **Decimal typing** — amount fields keep `"1."` while typing; parse on blur via `AmountInput` + `nextAmountDraft` / `amountFromDraft` in `lib/money.ts`. Wired on invoice header (extra tax, ST withheld, header discount), line grid (qty, rate, sale, discount, further tax), and POS qty/sale.
2. **Full UUID IDs** — `newId` returns `prefix_` + `crypto.randomUUID()`. Legacy short ids still accepted (`isLegacyShortId`). New invoice rows use `add` via `persistInvoice` (save, validate, submit, clone, credit/debit, import).
3. **Credit notes negate totals** — `signedInvoiceAmount` / `invoiceAmountSign` in ledger; reports and Excel working papers use the same sign.
4. **logEvent cannot un-post** — PRA result is persisted first; `logEvent` is in its own try/catch. If the row is already `posted`, a later network catch does not rewrite it to `failed`.
5. **Line discount (Matloob chose A)** — tax on `(sale − discount)`; header `Discount` = sum of line discounts; both appear on print and in the PRA payload. Header field is read-only and follows the lines. Excel `HeaderDiscount` lands on the first line when line discounts are empty.
6. **Unsaved leave** — `useUnsavedGuard` now blocks in-app routes (`useBlocker`), client switch, and period switch (via `leaveGate` + DeskContext), plus the existing tab-close warning. Confirm: “Leave without saving?”
7. **Startup failure** — `bootDesk` catches seed errors; App shows a plain error screen with **Export what can be read** and **Try again**.

## Files

- `pra/src/lib/money.ts`, `money.test.ts`
- `pra/src/lib/ids.ts`, `ids.test.ts`
- `pra/src/lib/leaveGate.ts`, `leaveGate.test.ts`
- `pra/src/lib/appBoot.ts`, `appBoot.test.ts`
- `pra/src/lib/pra.ts`, `pra.test.ts` (tax base + header sync + validate)
- `pra/src/lib/excel.ts` (signed output tax; HeaderDiscount parse)
- `pra/src/domain/ledger.ts`, `reports.ts`, `invoices.ts`, `invoices.test.ts` (`withTotals`, import)
- `pra/src/components/Field.tsx` (`AmountInput`), `InvoicePrint.tsx` (Discount column + footer)
- `pra/src/hooks/useUnsavedGuard.tsx` (renamed from `.ts`)
- `pra/src/context/DeskContext.tsx`
- `pra/src/pages/InvoiceEditor.tsx`, `PosSale.tsx`, `Clients.tsx`, `Buyers.tsx`
- `pra/src/App.tsx`, `main.tsx` (data router for `useBlocker`)

## Proof

From `pra/`:

- `npm test` → **200 passed** (33 files)
- `npx tsc -b` → clean
- `npm run lint` → no new errors (existing warnings only)

## Discount A (closed)

Matloob: tax on (sale − discount); show discount on invoice; line discounts must sum to header Discount. Implemented; no further decision needed.

## Left for later phases

Phase 3+: `/pra-ims` proxy lock-down, QR/print, period lock, backend plan. Phase 2 is done (`batch-6-phase-2-done.md`). Do not start Phase 3 until Matloob says `NEXT PHASE`.
