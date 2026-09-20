# Batch 4 — Desk, print, reports (Agent 4)

You are **Agent 4** for Daftar (`pra/`).

## Read first (in this order)

1. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\PROTOCOL.md`
2. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\CONTRACT.md`
3. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\README.md`
4. `pra/src/pages/Desk.tsx`
5. `pra/src/App.tsx`
6. `pra/src/components/AppShell.tsx`
7. `pra/src/components/CommandJump.tsx`
8. `pra/src/components/InvoicePrint.tsx`
9. `pra/src/components/Field.tsx`
10. `pra/src/context/DeskContext.tsx`
11. `pra/src/pages/Invoices.tsx` (filters only — do not redo editor)
12. `pra/src/pages/settings/Security.tsx`
13. `pra/src/domain/ledger.ts`
14. `pra/ops/agents/handoff/batch-1-plan.md`, `batch-2-plan.md`, `batch-3-plan.md`
15. Done files 1–3 **required before IMPLEMENT**

## Your job

Daily desk: find, print, report, a11y, mobile. Use data Batch 2–3 already store. Do not invent IRIS sync.

## Must add

1. Reports (new route or Desk panels): sales book, tax by PCT, buyer ledger, unpaid / PSID gap, failed posts. Export CSV or Excel using existing `lib/excel.ts` style.
2. Desk: simple charts or sparklines + 15th/18th calendar + period compare. Keep current attention jumps.
3. Invoice list: text search, date range, buyer filter (if Batch 3 did not).
4. Global search: USIN / buyer / client — extend `CommandJump` (entity search, not only routes).
5. Print: seller CNIC (and `cnicAsRegistration` / personName if present), letterhead from practice name, clearer draft vs posted. Thermal **optional**. QR only if you can encode fields we already have — do not fake a PRA QR spec.
6. Activity: raise 40-row cap or paginate; CSV export. Do not log tokens.
7. First-run / empty hosted desk: live checklist copy (token → whitelist email → first post) without seeding Demo in prod.
8. PIN: real lock control in `AppShell` (remove “lock later” if PIN already exists); idle timeout.
9. Loading skeletons on editor/buyers/items/psids/returns; error boundary; simple offline indicator.
10. A11y: `Field` `htmlFor`/`id`; invoice line inputs named; CommandJump focus trap; SearchPick `aria-activedescendant` if cheap.
11. Mobile: invoice table + More nav — masters must stay reachable.
12. Remove duplicate `AppShell` trees in `App.tsx` if `/` and `/pra` still mount two copies — **one** shell.

## Do not

- Load every invoice into memory if you can page — `DeskContext` `toArray()` is yours to bound if you touch it
- Add a Node server (Batch 5)
- File ownership fights with Batch 3 on InvoiceEditor — only print + list filters
- Deploy / commit / scrape IRIS

## PLAN output

Write `pra/ops/agents/handoff/batch-4-plan.md` then STOP.

## IMPLEMENT

Only after `IMPLEMENT BATCH 4` and done files 1–3 exist.  
Write `pra/ops/agents/handoff/batch-4-done.md`.  
`cd pra && npm test && npm run build`
