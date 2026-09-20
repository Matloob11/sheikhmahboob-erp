# Batch 2 plan — Client file (Agent 2)

Mode: **PLAN only**. No `pra/src` edits until `IMPLEMENT BATCH 2` **and** `handoff/batch-1-done.md` exists.

`handoff/batch-1-plan.md` was **not present** when this plan was written (2026-09-18). Re-read Batch 1 plan/done before implement and rebase on their cascade / unique-return / backup changes.

No **CONTRACT-DELTA**. Field names match `CONTRACT.md`.

---

## 1. Files I will touch

Owned / implement after Batch 1:

| File | Why |
|------|-----|
| `pra/src/types.ts` | Client extras, Buyer/CatalogItem extras, Invoice/Purchase/Return/Psid extras, new table types, optional `purchase.updated` event |
| `pra/src/db.ts` | Dexie **v4** stores for new tables; `emptyInvoice` defaults; demo seed gets optional extras only (no seed-policy change) |
| `pra/src/lib/backup.ts` | Backup **v5**: export/import/preview/merge of new tables; keep encrypt/strip + merge-by-id. Rebase after Batch 1 (`importBackup` deprecate / restore lock) |
| `pra/src/domain/clients.ts` | Cascade new child tables (after Batch 1 cascade); registration helpers; optional place/bank/POS CRUD or thin wrappers |
| `pra/src/domain/places.ts` | **New.** `clientPlaces` CRUD; one primary; sync primary onto `Client.address/city/branchName/branchId` |
| `pra/src/domain/banks.ts` | **New.** `clientBanks` CRUD; one primary |
| `pra/src/domain/posDevices.ts` | **New.** `clientPosDevices` CRUD; one active device copies `posId` + `environment` onto `Client`; **token stays on `Client.posToken` only** |
| `pra/src/domain/buyers.ts` | Buyer extras + search/validate |
| `pra/src/domain/items.ts` | Item extras; optional “add sector default” |
| `pra/src/domain/catalog.ts` | `defaultCatalogItemFromSector`; search includes unit |
| `pra/src/domain/psids.ts` | Update existing row (`id?`); `dueOn`, `paidAmount` |
| `pra/src/domain/returns.ts` | Purchase **edit** + CONTRACT purchase extras; Return `filedAt`, `irisAck` only (unique period stays Batch 1) |
| `pra/src/pages/Clients.tsx` | Tabs: Profile / Places / Banks / POS; extras; archive; No-PNTN gap |
| `pra/src/pages/FirstRun.tsx` | Collect CNIC, phone, email, city, address (not only name + PNTN + POS) |
| `pra/src/pages/Buyers.tsx` | address, district, email, buyerType |
| `pra/src/pages/Items.tsx` | unit, defaultQty, inactive; optional sector-default button |
| `pra/src/components/NeedClient.tsx` | Filter `archived` from picker; keep Add-client path |

Tests (new or extend):

- `pra/src/domain/clients.test.ts` (new)
- `pra/src/domain/buyers.test.ts`
- `pra/src/domain/catalog.test.ts`
- `pra/src/lib/backup.test.ts`
- small `returns` / `psids` unit tests if no file exists yet (`returns.test.ts`, `psids.test.ts`)

---

## 2. Exact functions / bugs

**Gaps today**

- Taxpayer identity (NTN, person, IRIS ids, ST status, archive, CNIC-as-registration) is missing — lives in Notes or nowhere.
- No places / banks / extra POS devices.
- First-run step 2 only asks name + PNTN + environment.
- Buyers have no address / district / email / type.
- Items have no unit / defaultQty / inactive.
- `addPurchase` is add-only; no `updatedAt` or Annex extras.
- `savePsid` always `add`s a new row.
- `markReturn` has no `filedAt` / `irisAck`.
- `removeClientFile` cascade (current) deletes client/invoices/purchases/returns/psids only — **not** buyers/items/events. Batch 1 must add those; I add `clientPlaces` / `clientBanks` / `clientPosDevices` after that.
- `fileGaps` / `clientReadiness` treat empty PNTN as urgent even when CNIC is the registration number.
- Backup v4 does not carry the new tables.

**Functions I will add or change**

| Function | Change |
|----------|--------|
| `hasClientRegistration(client)` | `clients.ts`. True if PNTN present **or** (`cnicAsRegistration` and CNIC is 13 digits). |
| `registrationDisplay(client)` | PNTN, else CNIC when `cnicAsRegistration`, else `""`. |
| `saveClient` | Persist new optional Client fields; do not invent tokens. |
| `removeClientFile` | After Batch 1: also delete places/banks/posDevices for that `clientId`. |
| `savePlace` / `removePlace` | Primary: copy `address`, `city`, `branchId`, `label` → `Client.branchName`. |
| `saveBank` / `removeBank` | Enforce a single `isPrimary`. |
| `savePosDevice` / `removePosDevice` / `activatePosDevice` | Copy `posId` + `environment` to `Client`. Never store `posToken` on the device row. |
| `validateBuyer` / `searchBuyers` / `buyerDraftFromInvoice` | New fields; search address/email/district. |
| `validateItemDraft` / `searchCatalogItems` | `unit`, `defaultQty` (≥ 0), `inactive`. |
| `defaultCatalogItemFromSector(sector)` | One mapped item from existing `PUNJAB_SERVICE_RATES` + `SECTORS`. Not a fake Punjab schedule. |
| `saveCatalogItem` | Persist extras. Optional helper `addSectorDefaultItem(clientId, sector)`. |
| `savePurchase` (or `addPurchase` + `updatePurchase`) | Edit by `id`; extras; set `updatedAt`. Keep `addPurchase` as create wrapper so Batch 3 can call either. |
| `savePsid` | Optional `id` → `put` update; `dueOn`; `paidAmount` defaults to `amount` when status is paid/claimed and omitted. |
| `markReturn` | On `filed`: set `filedAt` (keep existing if already set); accept `irisAck?: string`. |
| `assembleBackup` / `readSnapshot` / `applyBackup` / `previewBackup` | Version **5**; include `clientPlaces`, `clientBanks`, `clientPosDevices`. Merge-by-id unchanged. |
| `emptyInvoice` | Defaults for invoice header extras only. |
| `Clients.tsx` `fileGaps` | Do **not** push `"No PNTN"` when `hasClientRegistration`. List label uses `registrationDisplay`. Hide archived unless “Show archived”. |
| `FirstRun` step 2 | CNIC, phone, email, city, address; checkbox `cnicAsRegistration`. POS still step 3. |
| `NeedClient` | `clients.filter((row) => !row.archived)` before `ClientPicker`. |

**Not changing:** `shouldSeedDemoClient`, PostData success rules, PIN/backup crypto, InvoiceEditor, print, reports, DeskContext (no rewrite; child tables via `useLive` on Clients like Buyers already do).

---

## 3. Schema / API (CONTRACT names)

### Dexie

Current: `daftar-pra` **v3**. I add **`version(4)`** (CONTRACT: new tables = v4+). Existing store indexes unchanged unless Batch 1 already added more.

```
clientPlaces:  id, clientId, isPrimary, updatedAt, [clientId+label]
clientBanks:   id, clientId, isPrimary, updatedAt
clientPosDevices: id, clientId, placeId, posId, updatedAt
```

Optional Client fields do **not** need new indexes. `archived` filter is in memory (client list is small). No DeskContext pagination.

### `Client` extras (all optional)

`ntn`, `personName`, `personType` (`"individual" \| "aop" \| "company" \| ""`), `businessId`, `branchId`, `stStatus`, `registeredOn`, `archived`, `cnicAsRegistration`.

Keep `address`, `city`, `branchName`, `posId`, `posToken` as the primary place / active POS.

### New tables

**`ClientPlace`:** `id, clientId, label, address, city, district, province, branchId, isPrimary, createdAt, updatedAt`

**`ClientBank`:** `id, clientId, bankName, accountTitle, accountNo, iban, isPrimary, notes, createdAt, updatedAt`

**`ClientPosDevice`:** `id, clientId, placeId?, posId, label, environment, createdAt, updatedAt`  
No token column. Active device → `Client.posId` / `Client.environment`. Token only on `Client.posToken`.

### Buyer extras

`address`, `district`, `email`, `buyerType` (`"registered" \| "unregistered" \| "end_consumer" \| "intermediary" \| ""`).

### CatalogItem extras

`unit` (string), `defaultQty` (number, default `1`), `inactive` (boolean, default `false`).

### Invoice header extras (types + `emptyInvoice` only)

`extraTax: number` (0), `stWithheld: number` (0), `reverseCharge: boolean` (false), `saleType: string` (`"Services"`), `taxpayerType: string` (`""`), `buyerDistrict: string` (`""`).  
Line `discount` already exists. Editor is Batch 3.

### Purchase extras

`supplierCnic`, `pctCode`, `district`, `withheld`, `reverseCharge`, `updatedAt`.

### ReturnPeriod extras

`filedAt?: number`, `irisAck: string`.

### PsidRecord extras

`dueOn: string`, `paidAmount: number`.

### Backup

`DeskBackup.version` includes `5`. New arrays: `clientPlaces?`, `clientBanks?`, `clientPosDevices?`.  
`BackupPreview` adds `places`, `banks`, `posDevices`.  
v1–v4 files still import (missing arrays = `[]`).  
Token vault / PBKDF2 / AES-GCM unchanged.

### Sector default item (not a schedule)

One row from existing `PUNJAB_SERVICE_RATES`:

| Sector | PCT |
|--------|-----|
| Restaurants | 98012000 |
| Hotel | 98011000 |
| Courier | 98080000 |
| Beauty parlor | 98100000 |
| IT / IT-enabled | 98155000 |
| Construction | 98142000 |
| Consultancy | 98154000 |
| Franchise | 98230000 |
| Transport | 98040000 |
| Other services | 00000000 |

`itemCode` like `SEC-98154000`, `unit` `"Svc"`, `defaultQty` `1`, `inactive` false.

---

## 4. Tests I will add

Pure unit tests (same style as `buyers.test.ts` / `backup.test.ts`; no IndexedDB unless already set up):

1. **`hasClientRegistration`** — empty PNTN + `cnicAsRegistration` + 13-digit CNIC → true; missing/short CNIC → false; PNTN present → true.
2. **`defaultCatalogItemFromSector`** — Consultancy → 98154000 / 16%; unknown sector → fallback PCT; does not invent codes outside `PUNJAB_SERVICE_RATES`.
3. **Buyer validate/search** — email shape; `buyerType`; search hits address/district.
4. **Item draft** — `defaultQty` cannot be negative; inactive items still validate.
5. **Backup v5** — `assembleBackup` version 5; preview counts places/banks/devices; `mergeById` keeps local-only place rows; v4 JSON still parses (empty new arrays).
6. **PSID update** — same `id` on second `savePsid` (pure record-shape helper if DB not available; otherwise domain function).
7. **Return** — marking `filed` sets `filedAt`; `irisAck` stored; re-mark does not wipe `filedAt`.
8. **Purchase extras** — update path sets `updatedAt` and `supplierCnic` / `blockedCredit` on the returned object.

Cascade delete: unit-test the list of tables/keys I will delete if I can extract a pure `clientChildIds` helper; otherwise prove manually + `npm test` after implement.

Prove: `cd pra && npm test && npm run build`.

---

## 5. What I will not do

- Implement before `IMPLEMENT BATCH 2` and `batch-1-done.md`.
- Rename CONTRACT fields.
- Store IRIS passwords or scrape IRIS.
- Change `shouldSeedDemoClient` or seed Ahmad Traders / any real taxpayer.
- Change PostData success rules (`pra.ts`).
- Reimplement backup encryption / PIN PBKDF2.
- Build InvoiceEditor, print, Excel annex columns, or reports (Batch 3 / 4).
- Rewrite `DeskContext` or paginate the whole desk.
- Duplicate `posToken` onto `clientPosDevices`.
- Invent official PSIDs or file returns on IRIS.
- Edit Batch 1 files (`validate.ts`, `invoices.ts`, `pra.ts`, excel bugfixes) except `backup.ts` **after** Batch 1, for v5 tables only.
- Edit Batch 4 files (`Desk.tsx`, `AppShell.tsx`, `ClientPicker.tsx`, `Settings.tsx`, `index.css`) except `NeedClient.tsx` as listed.
- Commit or deploy.

---

## 6. Blocked / needs other batch

| Need | Who | Why |
|------|-----|-----|
| `handoff/batch-1-done.md` | Batch 1 | Required before I implement. Cascade for buyers/items/events; unique return; backup lock/deprecate. |
| `clientReadiness` “PNTN missing” | Batch 1 owns `validate.ts` | I will fix `Clients.tsx` `fileGaps`. Desk attention still uses `validate.clientReadiness`. Batch 1 should skip `"PNTN missing"` when `cnicAsRegistration && isCnic(cnic)` (same rule as `hasClientRegistration`). If they ship without it, leftover for them to rebase or Batch 4 Desk copy only — I must not edit `validate.ts`. |
| Hide archived in chrome | Batch 4 | `AppShell`, `ClientPicker` (except via `NeedClient` filter), `Desk.tsx` “No PNTN” label should use `registrationDisplay` / skip archived. |
| Invoice extras in editor / Excel | Batch 3 | Types + `emptyInvoice` only from me. |
| Purchase/PSID edit UI | Batch 3 | Domain save/update from me; `Returns.tsx` / `Psids.tsx` are Batch 3. |
| Settings backup preview copy | Batch 4 | I add preview counts; Settings string still lists old tables until they update. |
| Activity filter for `purchase.updated` | Batch 4 | If I add the kind; existing `purchase.*` filter already matches. |

**Token decision (documented):** one plaintext token on `Client.posToken` for the active device. Extra POS rows are id/label/place/environment only. No second copy in the device table.
