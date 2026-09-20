# Batch 7 Phase B — posted totals stay frozen

Discount A recalculates tax as sale − discount. Invoices already posted (or `unknown`) under the old rules must keep their stored line and header amounts everywhere.

## What changed

- `totalsForInvoice` / frozen `withTotals`: posted + unknown keep stored totals and line tax.
- Annex C / Excel working paper uses stored line tax, not `recalcLine`.
- Editor and POS display use `totalsForInvoice`.

## Proof

`npm test` → 203 passed. `tsc -b` clean.

## Left

Phase C (compliance), D (UI batch 2), E (backend plan).
