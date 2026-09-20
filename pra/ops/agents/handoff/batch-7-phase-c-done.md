# Batch 7 Phase C — compliance and trust

## What changed

1. **Print banners** — unposted prints show `DRAFT — not a tax invoice`; sandbox posts show `SANDBOX — test only` plus fiscal when present. Fiscal number stays on the print; no QR invented (PRA POS manual did not give a clear encode format).
2. **Period lock** — when a return is `filed`, invoices and purchases in that period cannot be added, edited or deleted until unlock. Unlock is a Confirm on Returns and logs `return.unlocked`.
3. **Client delete** — cascade blocked when any invoice is `posted` or `unknown` (chosen: block, not archive).
4. **Purchase delete** — logged as `purchase.removed`.
5. **Backup** — export builds JSON per table into a Blob (not one giant `JSON.stringify` of the whole desk). Merge is newest-wins; never downgrades `posted`; never blanks a local POS token; never overwrites practice PIN or selected client.
6. **Plain-language PRA errors** — `mapPraOutcome` uses `uiStrings`; shared UI copy lives in `src/lib/uiStrings.ts` for later Urdu.

Already done (not redone): Confirm focus/Tab trap, POS Print receipt, 80 mm `@page`, go-live checklist.

## Files (main)

- `pra/src/domain/periodLock.ts`, `periodLock.test.ts`
- `pra/src/domain/print.ts`, `print.test.ts`
- `pra/src/domain/clients.ts`, `clients.test.ts`
- `pra/src/domain/invoices.ts`, `invoices.test.ts`
- `pra/src/domain/returns.ts`
- `pra/src/lib/backup.ts`, `backup.test.ts`
- `pra/src/lib/pra.ts`, `uiStrings.ts`
- `pra/src/pages/Returns.tsx`
- `pra/src/types.ts` (`return.unlocked`, `purchase.removed`)

## Proof

From `pra/`:

- `npm test` → **208 passed** (34 files)
- `npx tsc -b` → clean
- `npm run lint` → warnings only (pre-existing)

## Contradictions

- QR: brief said encode only if the POS manual specifies it. Manual was not clear → fiscal number only, QR omitted. Needs PRA’s answer later.

## Left

Phase D (UI batch 2), Phase E (backend plan only).
