# Batch 2 done — Client file

Agent 2. IMPLEMENT complete. Rebased on `handoff/batch-1-done.md` (cascade buyers/items/events, unique return, `importBackup` throw + restore lock). Did not start Batch 3–5.

## 1. What shipped

- Client extras: `ntn`, `personName`, `personType`, `businessId`, `branchId`, `stStatus`, `registeredOn`, `archived`, `cnicAsRegistration`.
- Dexie **v4** tables `clientPlaces`, `clientBanks`, `clientPosDevices`. Unique `&[clientId+usin]` and `&[clientId+period]` on this bump.
- `hasClientRegistration` / `registrationDisplay`: CNIC-as-registration (13 digits) is not a “No PNTN” gap. Clients list can hide archived files.
- Clients UI tabs: Profile / Places / Banks / POS. One plaintext token on `Client.posToken` only.
- First-run step 2 collects CNIC, phone, email, city, address, and `cnicAsRegistration`.
- Buyer extras: address, district, email, buyerType. Item extras: unit, defaultQty, inactive. Sector default from existing `PUNJAB_SERVICE_RATES` only.
- Invoice header extras on types + `emptyInvoice`. Purchase **edit** (`savePurchase`) + extras. PSID update by `id`. Return `filedAt` / `irisAck` (unique period unchanged).
- `removeClientFile(..., true)` also deletes places / banks / POS devices (keeps Batch 1 buyer/item/event cascade).
- `ensureSeed` calls `sweepHungInFlight()` on every launch.
- Backup export **v5** includes the new tables; merge-by-id; v1–v4 still import. `importBackup` still throws; restore still `lockPractice()`.

## 2. Files changed

- `pra/src/types.ts`
- `pra/src/db.ts`
- `pra/src/lib/backup.ts`
- `pra/src/lib/backup.test.ts`
- `pra/src/domain/clients.ts`
- `pra/src/domain/clients.test.ts`
- `pra/src/domain/places.ts` (new)
- `pra/src/domain/banks.ts` (new)
- `pra/src/domain/posDevices.ts` (new)
- `pra/src/domain/buyers.ts`
- `pra/src/domain/buyers.test.ts`
- `pra/src/domain/items.ts`
- `pra/src/domain/catalog.ts`
- `pra/src/domain/catalog.test.ts`
- `pra/src/domain/psids.ts`
- `pra/src/domain/psids.test.ts` (new)
- `pra/src/domain/returns.ts` (new fields + purchase edit; unique period kept)
- `pra/src/domain/returns.test.ts`
- `pra/src/pages/Clients.tsx`
- `pra/src/pages/FirstRun.tsx`
- `pra/src/pages/Buyers.tsx`
- `pra/src/pages/Items.tsx`
- `pra/src/components/NeedClient.tsx`

Did not edit `validate.ts`, `invoices.ts`, `pra.ts`, excel, InvoiceEditor, Desk, AppShell, Settings, `index.css`, or `shouldSeedDemoClient`.

## 3. Public functions / field names (final)

| Name | Module |
|------|--------|
| `hasClientRegistration` | `clients.ts` |
| `registrationDisplay` | `clients.ts` |
| `emptyClientDraft` | `clients.ts` |
| `CLIENT_CASCADE_STORES` | `clients.ts` |
| `savePlace` / `removePlace` | `places.ts` |
| `saveBank` / `removeBank` | `banks.ts` |
| `savePosDevice` / `removePosDevice` / `activatePosDevice` | `posDevices.ts` — no token column |
| `defaultCatalogItemFromSector` | `catalog.ts` |
| `addSectorDefaultItem` | `items.ts` |
| `savePurchase` / `addPurchase` | `returns.ts` (`addPurchase` = create wrapper) |
| `savePsid` | `psids.ts` — optional `id` updates |
| `paidAmountFor` | `psids.ts` |
| `markReturn` | `returns.ts` — `irisAck?`; `filedAt` kept on re-mark |

CONTRACT names unchanged. No CONTRACT-DELTA. Token stays on `Client.posToken`.

## 4. How to prove

From `pra/`:

```bash
npm test
npm run build
```

This run: **106 tests passed**, `tsc -b && vite build` succeeded.

## 5. Leftovers for the next agent

**Batch 3**

- Expose invoice header extras and line discount in InvoiceEditor / Excel.
- Purchase / PSID edit UI (`Returns.tsx` / `Psids.tsx`) can call `savePurchase` / `savePsid({ id })`.
- Return UI: show `filedAt` / `irisAck`; keep `annexCRows` (Batch 1 leftover).

**Batch 4**

- Hide archived in `AppShell` / `ClientPicker` / Desk (NeedClient already filters).
- Desk “No PNTN” / `clientReadiness` still says `"PNTN missing"` — `validate.ts` is Batch 1; I did not edit it.
- Settings backup copy still omits places / banks / POS counts (`preview.places` / `banks` / `posDevices` exist).

**Dexie**

- v4 unique indexes assume no existing duplicate USIN/period rows. Domain already refused those after Batch 1.
