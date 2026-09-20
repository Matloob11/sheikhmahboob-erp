# Batch 3 — Invoice + return pack (Agent 3)

You are **Agent 3** for Daftar (`pra/`).

## Read first (in this order)

1. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\PROTOCOL.md`
2. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\CONTRACT.md`
3. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\README.md`
4. `pra/src/pages/InvoiceEditor.tsx`
5. `pra/src/pages/Invoices.tsx`
6. `pra/src/pages/Returns.tsx`
7. `pra/src/pages/Psids.tsx`
8. `pra/src/lib/pra.ts` (`buildPayload`, `validateInvoice`)
9. `pra/src/lib/excel.ts`
10. `pra/src/domain/invoices.ts`
11. `pra/ops/agents/handoff/batch-1-plan.md` + `batch-2-plan.md` (always)
12. `handoff/batch-1-done.md` + `batch-2-done.md` (**required before IMPLEMENT**)

## Your job

Wire invoice / annex / PSID **UI and payload** to CONTRACT fields after Batch 2 stored them. Official PostData extras only if they already exist on the client object and PRA manual allows them — do not invent GetData.

## Must add

1. Invoice editor: date picker (keep stored format `YYYY-MM-DD HH:MM:SS`), **line** discount, sale type, extra tax, ST withheld, reverse charge, taxpayer type, buyer district.
2. B2B / B2C / end-consumer vs intermediary using `buyerType` when present.
3. Credit/debit: **partial** adjust (not always full-line clone).
4. Annex A: edit existing purchase; HS/PCT, supplier CNIC, notes, district, withheld, reverse charge.
5. Annex C + return Excel: fill district / ST withheld / reverse charge from stored fields; **all lines** (Batch 1 may have fixed the aggregator — do not regress).
6. IRIS-style **Excel import** for sales (and annex if you can map columns) — file import only, no portal scrape. Preview + per-row errors.
7. `validated` status: either require validate-before-post in the list UI or remove the fake pipeline. Do not leave a misleading “Validate listed” that does nothing.
8. Bulk post: progress, cancel, keep results after navigation (session or Dexie), do not undo Batch 1 inFlight rules.
9. POS / production checklist strip: token missing, sandbox token on production, note that IP whitelist + `/pra-ims` TLS are ops (link README). Do not fake whitelist as approved.
10. PSID form: edit row, due date, partial `paidAmount`, pick bank from Batch 2 bank master if present.
11. Payload: keep `InvoiceNumber: ""`. Do not add ExtraTax to PostData unless you also update `pra.test.ts` and document the manual field. Prefer storing extras locally and exporting them on annex if PRA PostData tests still forbid ExtraTax.

## Do not

- Scrape IRIS or call GetData
- Create official PSIDs
- Change success-code rules from Batch 1
- Rebuild Desk charts / print (Batch 4)
- Change demo seed
- Deploy / commit

## PLAN output

Write `pra/ops/agents/handoff/batch-3-plan.md` then STOP.

## IMPLEMENT

Only after `IMPLEMENT BATCH 3` and batch 1+2 done files exist.  
Write `pra/ops/agents/handoff/batch-3-done.md`.  
`cd pra && npm test && npm run build`
