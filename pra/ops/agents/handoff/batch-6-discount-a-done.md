# Batch 6 — Discount A done

Matloob chose **A**: tax on (sale − discount); discount on the invoice; line discounts sum to header Discount.

## Behaviour

- `recalcLine`: taxable = sale − discount; tax = taxable × rate; line total = taxable + tax + further tax.
- `totalsFromItems` / `withTotals`: header `discount` = sum of line discounts; bill = sale + tax + further − discount.
- Validate rejects header ≠ line sum, negative discount, or discount > sale.
- Invoice editor: header discount read-only; edit lines only.
- Print: Discount column + footer when &gt; 0.
- Excel import: `HeaderDiscount` applied to first line if line discounts are all zero.

## Files

- `pra/src/lib/pra.ts`, `pra.test.ts`
- `pra/src/domain/invoices.ts`, `invoices.test.ts`
- `pra/src/pages/InvoiceEditor.tsx`, `PosSale.tsx`
- `pra/src/components/InvoicePrint.tsx`

## Proof

From `pra/`: `npm test` (200), `npx tsc -b`, `npm run lint` — clean aside from existing warnings.

## Waiting

`NEXT PHASE` for Phase 3 (proxy). No deploy / commit unless asked.
