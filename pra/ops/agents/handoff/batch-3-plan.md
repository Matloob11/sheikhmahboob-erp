# Batch 3 plan — Invoice + return pack

Agent 3. PLAN only. Written against `CONTRACT.md`, current `pra/src` (schema still v3), `01-integrity.md`, and `02-file.md`.  
`handoff/batch-1-plan.md` and `batch-2-plan.md` were **not present** when this was written. IMPLEMENT waits for `batch-1-done.md` and `batch-2-done.md`, then rebases names if those files differ from CONTRACT.

## 1. Files I will touch

Owned (edit):

- `pra/src/pages/InvoiceEditor.tsx`
- `pra/src/pages/Invoices.tsx`
- `pra/src/pages/Returns.tsx`
- `pra/src/pages/Psids.tsx`
- `pra/src/lib/excel.ts` (columns + IRIS-style import; do not undo Batch 1 parse/`indexOf` fixes)
- `pra/src/lib/pra.ts` — **payload extras only if** CONTRACT fields exist **and** we decide to send them. Default: **do not** add ExtraTax / ST withheld / reverse charge to PostData (`pra.test.ts` already forbids ExtraTax).
- `pra/src/domain/invoices.ts` — **editor/import hooks only** after Batch 1 locks (`createAdjustmentDraft` optional picks; import preview/commit). Do not change `submitGate`, success codes, or inFlight.

Tests I will add (new or next to owned files):

- `pra/src/lib/excel.test.ts` (create if missing) — annex C one-row-per-line; IRIS header aliases; import preview errors
- `pra/src/domain/invoices.test.ts` — partial credit/debit picks; import commit skips bad rows
- `pra/src/lib/pra.test.ts` — **only if** I change `buildPayload` (I plan not to)

I will **not** edit: `types.ts`, `db.ts`, `backup.ts`, `clients.ts`, `buyers.ts`, `items.ts`, `catalog.ts`, `psids.ts`, `returns.ts`, `validate.ts`, `Desk.tsx`, `AppShell.tsx`, `InvoicePrint.tsx`, `Field.tsx`, `seed.ts`, nginx, deploy scripts.

If Batch 2 does not ship save/update helpers, Returns/Psids will `db.purchases.put` / `db.psids.put` from the owned pages (no domain-file edit).

## 2. Exact functions / bugs

### Invoice editor (`InvoiceEditor.tsx`)

Current: date is a free-text `YYYY-MM-DD HH:MM:SS` box; line `discount` exists on `InvoiceLine` and in PostData but **has no column**; header extras (`extraTax`, `stWithheld`, `reverseCharge`, `saleType`, `taxpayerType`, `buyerDistrict`) are not on types yet and not in the form; credit/debit confirm copies **every** line via `createAdjustmentDraft`; no POS checklist.

Will add:

1. **Date picker** — `<input type="date">` + time (`HH:MM` or `HH:MM:SS`) composed with existing `formatDateTime` / `PRA_DATE_TIME`. Stored value stays `YYYY-MM-DD HH:MM:SS`. Do not edit `Field.tsx` (Batch 4); use `TextInput type="date"` like Returns already does.
2. **Line discount** column; `patchLine` already goes through `recalcLine`.
3. Header fields (after Batch 2 types exist): `saleType` (default `"Services"`), `taxpayerType`, `extraTax`, `stWithheld`, `reverseCharge` (checkbox), `buyerDistrict`.
4. **Buyer type** — when a buyer is picked, copy CONTRACT `buyer.buyerType` and `buyer.district` onto the invoice (`buyerDistrict`). If `applyBuyerToInvoice` is still the old 5-field pick, copy extras in the editor `onPick` (do not edit `buyers.ts`). Infer when unset: PNTN → `registered`; else CNIC-only walk-in → `end_consumer`; explicit master value `intermediary` wins.
5. **Partial credit/debit** — confirm dialog lists posted lines with qty/sale checkboxes. Call extended `createAdjustmentDraft(client, source, type, picks?)`. Omit `picks` → current full clone (Batch 1 tests stay green).
6. **POS / production strip** on editor + list: token missing; production + published sandbox token; production + no token. Copy: IP whitelist and `/pra-ims` TLS are **ops leftovers** — link `pra/README.md` leftovers + `mailto:eims@pra.punjab.gov.pk`. Never show whitelist as approved.
7. Review panel: show stored extra tax / ST withheld / reverse charge locally. Print stays Batch 4.

### Invoice list (`Invoices.tsx`)

Current: `Validate listed` **does** call `validateInvoiceBatch` (sets `validated`). It is not a no-op. Bulk post has no progress/cancel; `results` die on navigation; import is fire-and-forget with no row errors.

Will add:

1. **Validate-before-post (list only)** — `Post listed` only sends rows with `status === "validated"` and not `inFlight`/`posted`. Button hint if drafts are selected: “Validate listed first.” Editor **Post** may still validate-then-send in one click (already honest). Do not invent a second status.
2. **Bulk post progress + cancel** — sequential `submitInvoice` (keep Batch 1 inFlight). `AbortController` / `cancelled` flag stops the **next** row; in-flight row is not force-cleared. Progress text: `3 / 12`.
3. **Keep results after nav** — `sessionStorage` key `daftar.bulkResults.${clientId}` (`{ id, ok, message, at }[]`). Rehydrate on mount. No new Dexie table.
4. **Import preview** — file → parse → modal table (USIN, date, buyer, line count, errors). Commit only rows with no errors. Duplicate USIN = row error, not silent skip-only.

### Returns (`Returns.tsx`) + `excel.ts`

Current bugs:

- Annex C **UI and Excel** use `items[0]` only (`firstPct` / `firstRate`). Multi-line invoices collapse.
- District / ST withheld / reverse charge columns are **empty strings**.
- Annex A is **add + remove** only. No HS/PCT, supplier CNIC, notes, district, withheld, reverse charge.

Will add:

1. `annexCExportRows(sales)` in `excel.ts` — **one Excel/UI row per invoice line**. Header extras (`buyerDistrict`, `stWithheld`, `reverseCharge`, `saleType`, `extraTax`) repeat per line; line sale/tax/PCT/rate from that line. Do not regress if Batch 1 already exploded the data function — reuse it.
2. Annex C table: one row per line; link still the invoice USIN.
3. Annex A form: edit existing row (load into form, save by id). Fields: HS/PCT, supplier CNIC, notes, district, withheld, reverse charge (plus today’s fields).
4. Purchase Excel columns filled from stored CONTRACT fields (not blanks).
5. Optional annex-A Excel **import** if columns map cleanly (preview + errors). File only.

Return `filedAt` / `irisAck`: Batch 2 storage. UI: optional read-only ack on Summary if present. Do not file on IRIS.

### PSID (`Psids.tsx`)

Current: add-only; no `dueOn`, no `paidAmount`, bank is free text; no edit.

Will add: edit existing row; `dueOn` date; `paidAmount` (default `amount` when status is paid/claimed and paidAmount empty); bank `<select>` from Batch 2 `clientBanks` if the table exists, plus free-text fallback. Still do not invent official PSIDs.

Ledger `psidPaid` still sums `amount` today. Changing `ledger.ts` is not Batch 3. Leftover for Batch 4: prefer `paidAmount ?? amount` when summing paid/claimed. Excel PSID sheet will write `dueOn` + `paidAmount` once fields exist.

### Payload (`pra.ts`)

- Keep `InvoiceNumber: ""`.
- **Do not** add ExtraTax / STWithheld / ReverseCharge to `PraInvoicePayload` unless Batch 1 done file + POS manual field list require it **and** `pra.test.ts` is updated in the same IMPLEMENT. Planned default: store locally, export on annex.

### Import / adjust hooks (`invoices.ts`)

- `buildAdjustmentDraft(source, type, usin, picks?)` — optional `picks: { sourceLineId, quantity?, saleValue? }[]`. Empty/omitted = all lines (today).
- Replace silent `importSalesFile` with:
  - `previewSalesImport(client, file)` → `{ rows, errors[], invoiceCount }`
  - `commitSalesImport(client, accepted)` → count
- Do not weaken `submitGate` / `inFlight`.

## 3. Schema / API I will add

**No new Dexie tables.** No CONTRACT rename. No `CONTRACT-DELTA`.

Consume Batch 2 fields (exact CONTRACT names):

| On | Fields |
|----|--------|
| `Invoice` | `extraTax`, `stWithheld`, `reverseCharge`, `saleType`, `taxpayerType`, `buyerDistrict` |
| `Buyer` | `address`, `district`, `email`, `buyerType` (`registered` \| `unregistered` \| `end_consumer` \| `intermediary` \| `""`) |
| `Purchase` | `supplierCnic`, `pctCode`, `district`, `withheld`, `reverseCharge`, `updatedAt` |
| `PsidRecord` | `dueOn`, `paidAmount` |
| `clientBanks` | bank picker |
| `ReturnPeriod` | `filedAt?`, `irisAck` (display only) |

Editor/import API (Batch 3):

```ts
export type AdjustmentPick = {
  sourceLineId: string;
  quantity?: number;
  saleValue?: number;
};

createAdjustmentDraft(client, source, invoiceType, picks?: ReadonlyArray<AdjustmentPick>)

export type SalesImportPreviewRow = {
  usin: string;
  dateTime: string;
  buyerName: string;
  lineCount: number;
  errors: string[];
  draft?: Invoice; // built, not saved
};

previewSalesImport(client, file): Promise<{ rows: SalesImportPreviewRow[] }>
commitSalesImport(client, drafts: Invoice[]): Promise<{ saved: number; skipped: number }>
```

Excel helpers:

```ts
annexCExportRows(sales: Invoice[]): Array<Record<string, string | number>>
normalizeImportHeaders(headers: string[]): Record<CanonicalSaleCol, number | null>
parseSalesWorkbook(file) // keep Daftar template; after Batch 1 col-0 fix
parseIrisOrDaftarSales(file) // alias map below
```

**IRIS / annex header aliases** (file import only — no portal):

| Canonical | Also accept |
|-----------|-------------|
| USIN | USIN, Document number |
| DateTime | DateTime, Document date |
| BuyerName | BuyerName, Buyer name |
| BuyerPNTN | BuyerPNTN, Buyer NTN / PNTN |
| BuyerCNIC | BuyerCNIC, Buyer CNIC |
| BuyerDistrict | District of buyer |
| PCTCode | PCTCode, HS code |
| SaleValue | SaleValue, Value of sales excl. ST |
| TaxRate | TaxRate, Rate |
| FurtherTax | FurtherTax, Extra / further tax |
| StWithheld | ST withheld at source |
| ReverseCharge | Tax reverse charged u/s 4 |
| SaleType | Sale type |
| BuyerType | Buyer type |

Document type SI/DN/CN → invoiceType 1/2/3. Dates `YYYY-MM-DD` get ` 00:00:00` so `PRA_DATE_TIME` still holds.

Buyer type on annex: stored `buyerType` if set; else PNTN → Intermediary/registered; else End consumer (same words as today’s Excel, plus CONTRACT values when present).

## 4. Tests I will add

1. `annexCExportRows` — two-line invoice → two export rows; distinct PCT/rate/sale; district/stWithheld/reverseCharge from header fields; no blank forced `""` when set.
2. `normalizeImportHeaders` — Daftar template USIN in column 0 still maps (depends on Batch 1 `indexOf` fix). IRIS “Buyer NTN / PNTN” maps to BuyerPNTN.
3. `previewSalesImport` — bad PCT / missing name → row.errors; good row has empty errors; existing USIN → error, not saved.
4. `commitSalesImport` — only error-free drafts written; count matches.
5. `buildAdjustmentDraft` with one of two lines / halved saleValue → note has one line and that amount; omitted picks → full clone (existing test).
6. Do **not** add ExtraTax to `buildPayload` tests unless payload changes (planned: leave Batch 1 assertion as-is).

Prove on IMPLEMENT: `cd pra && npm test && npm run build`.

## 5. What I will not do

- Scrape IRIS, call GetData, invent fiscals, invent official PSIDs, file a return
- Change PRA success codes (`100` / `00`) or inFlight sweep
- Add ExtraTax to PostData by default
- Change `shouldSeedDemoClient` or seed Ahmad Traders
- Rebuild Desk charts, print letterhead, Field a11y, AppShell (Batch 4)
- Edit Batch 2 masters (Clients / Buyers / Items / FirstRun / backup schema)
- Deploy or commit

## 6. Blocked / needs other batch

**Must exist before IMPLEMENT (protocol):** `handoff/batch-1-done.md` and `handoff/batch-2-done.md`.

### Batch 1 (do not undo)

- `parseSalesWorkbook` column-0 / `indexOf` fix
- Header discount on import (`totalsFromItems` must not force `0`)
- Annex C data exploded to all lines if they put the helper in `excel.ts` — I will call it, not revert to `items[0]`
- `inFlight` / unique USIN / unique return / success codes

### Batch 2 (storage I consume)

Need these **names** on disk + backup v5:

- Invoice extras + `emptyInvoice` defaults (`saleType: "Services"`, numbers `0`, `reverseCharge: false`)
- Buyer extras; ideally `applyBuyerToInvoice` also returns `buyerDistrict` / type — if not, editor copies
- Purchase extras + **edit** path (`savePurchase` / `updatePurchase` or I put from `Returns.tsx`)
- PSID `dueOn`, `paidAmount` + **update** existing id
- `clientBanks` readable (`db.clientBanks.where("clientId")`)
- `cnicAsRegistration` is Client-file only (Batch 2/4 attention). I will not treat buyer CNIC as seller registration.

If Batch 2 ships a CONTRACT-DELTA rename, rebase this plan to their done file. I will not invent aliases.

### Batch 4 leftovers (not me)

- Print extras (seller CNIC, letterhead)
- Invoice list text/date/buyer filters
- `ledger.psidPaid` using `paidAmount`
- Field `htmlFor`, editor skeletons
- Desk charts

### Ops leftovers (README — do not fake)

- Production IP whitelist not approved
- `/pra-ims` TLS 502
- Real POS token vs demo `100000`
