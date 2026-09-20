# Batch 3 done — Invoice + return pack

Agent 3. IMPLEMENT complete. Rebased on `handoff/batch-1-done.md` and `handoff/batch-2-done.md`. Did not start Batch 4–5. Did not add ExtraTax to PostData.

## 1. What shipped

- Invoice editor: date + time pickers (stored `YYYY-MM-DD HH:MM:SS`), line discount column, header extras (`saleType`, `taxpayerType`, `extraTax`, `stWithheld`, `reverseCharge`, `buyerDistrict`), inferred / master buyer type, partial credit/debit line picks, POS/production checklist (token missing, sandbox token on production, ops leftovers — whitelist never shown as approved).
- Invoice list: **Post listed** only sends `status === "validated"` (not inFlight). Drafts show “Validate listed first.” Bulk post is sequential `submitInvoice` with `N / M` progress and cancel-next (in-flight row not force-cleared). Results persist in `sessionStorage` key `daftar.bulkResults.${clientId}`. Excel import previews rows + per-row errors; commit writes error-free drafts only.
- Returns: Annex C UI is one row per invoice line; Annex A can edit an existing purchase and stores HS/PCT, supplier CNIC, notes, district, withheld, reverse charge. Purchase Excel columns and Annex C export fill stored extras. Optional Annex A Excel import (file only). Summary shows `filedAt` / `irisAck`.
- PSID: edit existing row; `dueOn`; `paidAmount` (blank uses Batch 2 `paidAmountFor` when paid/claimed); bank `<select>` from `clientBanks` plus free-text fallback.
- Excel: `annexCExportRows`, IRIS header aliases, `HeaderDiscount` on the sales template, date-only cells padded to `00:00:00`.
- Domain: `buildAdjustmentDraft(..., picks?)` — omitted/empty picks still clone all lines. `previewSalesImport` / `commitSalesImport`. `importSalesFile` now commits only error-free rows.
- Payload: `InvoiceNumber` stays `""`. No ExtraTax / STWithheld / ReverseCharge on `PraInvoicePayload`.

## 2. Files changed

- `pra/src/pages/InvoiceEditor.tsx`
- `pra/src/pages/Invoices.tsx`
- `pra/src/pages/Returns.tsx`
- `pra/src/pages/Psids.tsx`
- `pra/src/lib/excel.ts`
- `pra/src/lib/excel.test.ts`
- `pra/src/domain/invoices.ts`
- `pra/src/domain/invoices.test.ts`

Did not edit `types.ts`, `db.ts`, `pra.ts` payload, `validate.ts`, `returns.ts`, `psids.ts`, `backup.ts`, Desk, AppShell, print, seed, nginx, or README.

## 3. Public functions / field names (final)

| Name | Module |
|------|--------|
| `AdjustmentPick` | `invoices.ts` |
| `buildAdjustmentDraft(source, type, usin, picks?)` | `invoices.ts` |
| `createAdjustmentDraft(client, source, type, picks?)` | `invoices.ts` |
| `splitInvoiceDateTime` / `composeInvoiceDateTime` | `invoices.ts` |
| `inferBuyerKind` | `invoices.ts` |
| `posChecks` | `invoices.ts` |
| `previewSalesImport` / `commitSalesImport` | `invoices.ts` |
| `SalesImportPreviewRow` | `invoices.ts` |
| `annexCExportRows` | `excel.ts` |
| `normalizeImportHeaders` | `excel.ts` |
| `normalizeImportedDateTime` / `invoiceTypeFromCell` | `excel.ts` |
| `parsePurchasesWorkbook` | `excel.ts` |

CONTRACT names unchanged. No CONTRACT-DELTA. Session key: `daftar.bulkResults.${clientId}`.

## 4. How to prove

From `pra/`:

```bash
npm test
npm run build
```

This run: **112 tests passed**, `tsc -b && vite build` succeeded.

## 5. Leftovers for the next agent

**Batch 4**

- Print extras (seller CNIC, letterhead, extra tax / ST withheld on A4).
- Invoice list text/date/buyer filters.
- `ledger.psidPaid` should prefer `paidAmount ?? amount` (still sums `amount` today).
- Field `htmlFor`, editor skeletons.
- Hide archived clients in AppShell / Desk (NeedClient already filters).

**Batch 5 / ops**

- Production IP whitelist still not approved.
- `/pra-ims` TLS 502 leftover.
- README “or a real fiscal InvoiceNumber” is still looser than Code `100`/`00` (Batch 1 leftover).
