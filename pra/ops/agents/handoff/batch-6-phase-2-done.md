# Batch 6 — Phase 2 done

Double-posting and posting state.

## What changed

1. **No remote PRA fallback** — browser only posts to `/pra-ims/…`. Timeout / 502 / HTML → `kind: "unknown"`, never `ims.pral.com.pk`.
2. **`unknown` status + reconcile** — unclear results stay `unknown`. Editor: “It was posted” (enter fiscal) / “It was not posted” (allow retry). Second post blocked until reconciled.
3. **No silent auto-repost** — `online` only lists candidates. Production never auto-sends. Sandbox may retry only after a confirm that lists USINs. Unclear rows are never auto-retried.
4. **USIN frozen / delete blocked** while `posted`, `unknown`, or `inFlight`.
5. **Send locks** — `inFlightAt` set on claim; sweep only locks older than 5 minutes (Dexie v5 index). Clear lock re-reads DB and will not overwrite a row another tab posted.
6. **`postedEnvironment` + `postedPosId`** stamped on success. Ledger / reports / Annex C count only non-sandbox posts. Print uses the posted env/POS, not the client’s current switch.
7. **POS sale** — same double-click guard (`postingRef`) and `catch` toast as the editor.

## Files (main)

- `pra/src/lib/pra.ts`, `pra.test.ts`, `pra-sandbox-path.test.ts`
- `pra/src/types.ts`, `db.ts` (v5 `inFlightAt`)
- `pra/src/domain/invoices.ts`, `invoices.test.ts`, `ledger.ts`, `ledger.test.ts`, `print.ts`, `invoiceList.ts`
- `pra/src/components/LiveOpsHost.tsx`, `InvoicePrint.tsx`, `Badge.tsx`
- `pra/src/pages/InvoiceEditor.tsx`, `PosSale.tsx`, `Invoices.tsx`
- `pra/src/index.css` (`.badge.unknown`)

## Proof

From `pra/`:

- `npm test` → **196 passed** (33 files)
- `npx tsc -b` → clean
- `npm run lint` → no new errors (existing warnings only)

## Contradictions

None — all seven Phase 2 findings matched the code.

## Still open from Phase 1

Line discount behaviour (A/B/C) — still waiting on Matloob.

## Left

Phase 3 (nginx `/pra-ims` lockdown — prepare only, no live reload). Say `NEXT PHASE`.
