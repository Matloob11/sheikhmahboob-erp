# Frozen field contract (plan against this)

Agents 2–5 plan using **these names**. Agent 2 may add fields but must not rename these without writing a `CONTRACT-DELTA` section in `handoff/batch-2-plan.md`.

Existing types live in `pra/src/types.ts`. Dexie DB `daftar-pra` is schema **v3** in `pra/src/db.ts`. New tables = **v4+**.

## Client (`Client`) — extra optional fields

| Field | Type | Notes |
|-------|------|--------|
| `ntn` | `string` | FBR NTN if different from PNTN |
| `personName` | `string` | Legal person (e.g. IFTIKHAR AHMAD) |
| `personType` | `"individual" \| "aop" \| "company" \| ""` | |
| `businessId` | `string` | IRIS business id (store, do not scrape) |
| `branchId` | `string` | IRIS branch id for the primary place |
| `stStatus` | `string` | e.g. Active |
| `registeredOn` | `string` | ISO or `YYYY-MM-DD` |
| `archived` | `boolean` | Hide from default picker |
| `cnicAsRegistration` | `boolean` | Individual: CNIC is the registration no. Do **not** treat as “No PNTN” urgent when true and CNIC is 13 digits |

Keep `address`, `city`, `branchName`, `posId`, `posToken` as the **primary** place / POS. Extra rows go to new tables.

## New tables

### `clientPlaces`

`id, clientId, label, address, city, district, province, branchId, isPrimary, createdAt, updatedAt`

### `clientBanks`

`id, clientId, bankName, accountTitle, accountNo, iban, isPrimary, notes, createdAt, updatedAt`

### `clientPosDevices`

`id, clientId, placeId?, posId, label, environment, createdAt, updatedAt`  
Token stays on `Client.posToken` for the **active** device (do not duplicate plaintext tokens across rows unless Agent 2 documents why).

## Buyer

`address, district, email, buyerType` where `buyerType` is `"registered" \| "unregistered" \| "end_consumer" \| "intermediary" \| ""`.

## CatalogItem

`unit, defaultQty, inactive` (`defaultQty` number, `inactive` boolean).

## Invoice (header extras)

`extraTax, stWithheld, reverseCharge, saleType, taxpayerType, buyerDistrict`

- `reverseCharge`: boolean  
- `saleType`: string (default `"Services"`)  
- `taxpayerType`: string  

Line already has `discount`. Editor must expose **line** discount (Batch 3). Header `discount` stays.

## Purchase extras

`supplierCnic, pctCode, district, withheld, reverseCharge, updatedAt`

## ReturnPeriod extras

`filedAt?: number`, `irisAck: string`

## PsidRecord extras

`dueOn: string`, `paidAmount: number` (partial; default `amount` when paid in full)

## Integrity rules (Batch 1, others must not undo)

- Unique USIN per client (enforce in domain; use `[clientId+usin]`).
- Unique return per `clientId+period`.
- `removeClientFile` deletes buyers, items, events, and any new child tables.
- PRA success = Code `100` or `00`. A lone fiscal that is not `"Not Available"` is **not** enough if the body is an error.
- `inFlight` cleared on startup (`ensureSeed` or equivalent sweep).
- `shouldSeedDemoClient` unchanged.

## Backup

Current export is backup **v4**. New tables/fields → bump export version in `lib/backup.ts` (Agent 2) and keep merge-by-id.

## Out of contract

No IRIS login fields. No password storage. No GetData client.
