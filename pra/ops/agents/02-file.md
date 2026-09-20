# Batch 2 — Client file (Agent 2)

You are **Agent 2** for Daftar (`pra/`).

## Read first (in this order)

1. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\PROTOCOL.md`
2. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\CONTRACT.md`
3. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\README.md`
4. `pra/src/types.ts`
5. `pra/src/db.ts`
6. `pra/src/domain/clients.ts`
7. `pra/src/domain/buyers.ts`
8. `pra/src/domain/items.ts`
9. `pra/src/domain/psids.ts`
10. `pra/src/domain/returns.ts`
11. `pra/src/lib/backup.ts`
12. `pra/src/pages/Clients.tsx`
13. `pra/src/pages/FirstRun.tsx`
14. `pra/src/pages/Buyers.tsx`
15. `pra/src/pages/Items.tsx`
16. `pra/ops/agents/handoff/batch-1-plan.md` (always) and `batch-1-done.md` (**required before IMPLEMENT**)

## Your job

Make the taxpayer **file** complete so data does not live in Notes. Follow `CONTRACT.md` field names.

## Must add

1. Client extras: `ntn`, `personName`, `personType`, `businessId`, `branchId`, `stStatus`, `registeredOn`, `archived`, `cnicAsRegistration`.
2. Tables: `clientPlaces`, `clientBanks`, `clientPosDevices` (Dexie v4+).
3. Client UI tabs: Profile / Places / Banks / POS (keep one primary POS token on `Client`).
4. First-run: collect CNIC, phone, email, city/address — not only name + PNTN + POS.
5. Buyer: address, district, email, buyerType.
6. Item: unit, defaultQty, inactive; optional default item from sector (do not invent a fake full Punjab schedule).
7. Invoice/Purchase/Return/Psid **types + Dexie + backup** for CONTRACT extras. Do **not** build the invoice editor (Batch 3).
8. Purchase domain: allow **edit**; add CONTRACT fields.
9. PSID domain: **update** existing row (not add-only).
10. Return: `filedAt`, `irisAck`.
11. Cascade delete must include new child tables (respect Batch 1 cascade if already shipped).
12. Attention / “No PNTN”: if `cnicAsRegistration` and CNIC is 13 digits, do not treat as missing PNTN emergency.
13. Backup export version bump; merge-by-id includes new tables.
14. Pagination or bounded queries if you touch `DeskContext` — prefer **not** rewriting DeskContext (Batch 4). If you must index new tables, do it in `db.ts` only.

## Do not

- Change `shouldSeedDemoClient` or seed Ahmad Traders
- Store IRIS passwords
- Change PostData success rules (Batch 1)
- Redesign InvoiceEditor / print / reports
- Deploy / commit / scrape IRIS

## PLAN output

Write `pra/ops/agents/handoff/batch-2-plan.md` then STOP.  
If you need a CONTRACT rename, add `## CONTRACT-DELTA`.

## IMPLEMENT

Only after `IMPLEMENT BATCH 2` **and** `handoff/batch-1-done.md` exists.  
Write `pra/ops/agents/handoff/batch-2-done.md`.  
`cd pra && npm test && npm run build`
