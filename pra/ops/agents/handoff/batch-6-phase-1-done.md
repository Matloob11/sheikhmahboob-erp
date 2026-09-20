# Batch 6 — Phase 1 done

Correctness bugs that put a wrong number on a tax invoice or lose data.

## What changed

1. **Decimal typing** — amount fields keep `"1."` while typing; parse on blur via `AmountInput` + `nextAmountDraft` / `amountFromDraft` in `lib/money.ts`. Wired on invoice header (extra tax, ST withheld, header discount), line grid (qty, rate, sale, discount, further tax), and POS qty/sale.
2. **Full UUID IDs** — `newId` returns `prefix_` + `crypto.randomUUID()`. Legacy short ids still accepted (`isLegacyShortId`). New invoice rows use `add` via `persistInvoice` (save, validate, submit, clone, credit/debit, import).
3. **Credit notes negate totals** — `signedInvoiceAmount` / `invoiceAmountSign` in ledger; reports and Excel working papers use the same sign.
4. **logEvent cannot un-post** — PRA result is persisted first; `logEvent` is in its own try/catch. If the row is already `posted`, a later network catch does not rewrite it to `failed`.
5. **Line discount** — **not changed.** Line discount is still sent in the payload but does not reduce the tax base (`recalcLine`). Header discount still reduces bill only. Needs Matloob’s decision (see below).
6. **Unsaved leave** — `useUnsavedGuard` now blocks in-app routes (`useBlocker`), client switch, and period switch (via `leaveGate` + DeskContext), plus the existing tab-close warning. Confirm: “Leave without saving?”
7. **Startup failure** — `bootDesk` catches seed errors; App shows a plain error screen with **Export what can be read** and **Try again**.

## Files

- `pra/src/lib/money.ts`, `money.test.ts`
- `pra/src/lib/ids.ts`, `ids.test.ts`
- `pra/src/lib/leaveGate.ts`, `leaveGate.test.ts`
- `pra/src/lib/appBoot.ts`, `appBoot.test.ts`
- `pra/src/lib/excel.ts` (signed output tax)
- `pra/src/domain/ledger.ts`, `reports.ts`, `invoices.ts`, `invoices.test.ts`
- `pra/src/components/Field.tsx` (`AmountInput`)
- `pra/src/hooks/useUnsavedGuard.tsx` (renamed from `.ts`)
- `pra/src/context/DeskContext.tsx`
- `pra/src/pages/InvoiceEditor.tsx`, `PosSale.tsx`, `Clients.tsx`, `Buyers.tsx`
- `pra/src/App.tsx`, `main.tsx` (data router for `useBlocker`)

## Proof

From `pra/`:

- `npm test` → **180 passed** (32 files)
- `npx tsc -b` → clean
- `npm run lint` → no new errors (existing warnings only)

## Needs from Matloob (before Phase 2)

**Line discount:** Today, line `Discount` is stored and sent to PRA but tax is still `saleValue × rate` (discount ignored). Header discount only reduces the bill total. How should discount work?

A) Line discount reduces that line’s tax base (sale − discount), then tax  
B) Line discount is display-only / ignored for tax (keep current)  
C) Something else (say how)

## Left for later phases

Phase 2+: double-post / unknown outcome, proxy lock-down, QR/print, period lock, backend plan. Do not start until Matloob says `NEXT PHASE`.
