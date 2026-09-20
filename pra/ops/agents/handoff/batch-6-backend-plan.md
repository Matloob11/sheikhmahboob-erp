# Backend plan for ~500 clients and staff (Batch 6 Phase 5 / Batch 7 Phase E)

**Status:** plan only — no application code in this phase.  
**Constraint:** same VPS `187.53.143.235` (Ubuntu, nginx, ERPNext). Do **not** install on the Frappe bench or disturb MariaDB used by ERPNext.

## Checklist vs `06-hardening.md` Phase 5

| Required | Covered |
|---|---|
| Postgres + small API on this VPS (not on Frappe bench) | Yes — Option A |
| Users, roles, client↔staff assignment, audit with actor | Yes |
| POS tokens encrypted server-side; browser never holds them | Yes |
| Server PostData + idempotency `(clientId, usin)` + queue + unknown/reconcile | Yes |
| Schema `period`, `(client_id, period)`, `(client_id, status)` + server pagination/search | Yes |
| Cross-client Today queue (drafts, failed, PSID, return, days to 15th/18th) | Yes |
| Monthly workflow → period locked | Yes (matches Phase C rules) |
| Nightly off-server backups | Yes |
| Migration from IndexedDB / JSON backups | Yes |
| Options + cost/effort + recommendation + Matloob decisions | Yes |

## Why the browser desk cannot scale

IndexedDB is per browser. Two PCs, two staff, or a wiped profile means two truths. Tokens live in the browser. Posting from the laptop bypasses the whitelisted IP unless every clerk uses `/pra-ims`. There is no real actor on events, no shared “Today” across devices, and backups are manual.

## Recommendation (default)

**Small Node (or Deno) API + Postgres on the same VPS**, reverse-proxied at `https://sheikhmahboob.com/pra-api/` (new location only — do not touch ERP locations). Keep the React desk as the UI; Dexie becomes a short-lived cache or is retired after migration.

| Option | Effort | Monthly cost (order) | Verdict |
|---|---|---|---|
| **A. Postgres + thin API on this VPS** | 4–8 weeks for MVP | ~0 extra host; ~0.5–1 day ops | **Recommend** |
| B. Managed Postgres off-box + API on VPS | 4–8 weeks | $15–40 DB | Safer backups; still fine |
| C. Stay browser-only + stricter process | 1 week process | 0 | Caps at ~1 PC / few clients |
| D. Full rewrite on Frappe/di | months | high | Wrong product shape; risks ERP |

## Architecture sketch

```
Browser desk ──HTTPS──► nginx
                 ├ /pra/        static SPA (unchanged host path)
                 ├ /pra-api/    Node API (new)
                 └ /pra-ims/    locked PostData proxy (already done)
Node API ──► Postgres (Docker or native on VPS, **separate** from ERP MariaDB)
Node API ──► PRA PostData via loopback / same whitelist path (never from clerk laptops)
```

- **Users / roles:** owner, manager, clerk, read-only. Session cookie or short JWT; login is practice staff, not PRA IRIS.
- **Client ↔ staff:** assignment table; clerks only see assigned clients; Today queue respects assignment.
- **Audit:** every write records `actorUserId`, `at`, `kind`, `entityId`. Browser `events` table maps into this.
- **POS tokens:** encrypted at rest (key in env / file outside git). Browser never receives plaintext after first save; posts use server-side token.
- **Posting:** server job keyed on `(clientId, usin)` idempotency. Queue + `in_flight` / `unknown` / reconcile from Phase 2. Never double-post without reconcile.
- **Schema indexes:** `period`, `(client_id, period)`, `(client_id, status)`, `(client_id, usin)` unique.
- **Pagination / search:** server-side for invoices, buyers, Today.
- **Today queue:** one row per client (drafts, failed, unknown, PSID gap, return status, days to 15th/18th); filterable, sortable, assignable.
- **Monthly workflow:** invoices → PSID → return filed → **period locked** (same rules as Phase C).
- **Backups:** nightly `pg_dump` to off-server object storage (Backblaze/S3) with retention; restore drill documented.
- **Migration:** export current Dexie/JSON backup → import API; map ids; keep USIN uniqueness per client; dry-run on a copy DB first.

## What Matloob must decide

1. **Host the API on this VPS (A) or managed DB (B)?** Default A.
2. **Staff auth:** email+password, or magic link, or both?
3. **Who may unlock a filed period?** Owner only vs manager?
4. **When to cut over:** parallel run (Dexie + sync) vs big-bang import weekend?
5. **Budget for off-server backups** (object storage account)?

## Out of scope for the first backend MVP

- Filing returns on IRIS / inventing PSIDs / GetData.
- Replacing ERPNext.
- Mobile native apps.

## Next implementation order (after this plan is approved)

1. Provision Postgres + API skeleton + `/pra-api` nginx location (backup/rollback like Phase A).
2. Auth + clients + assignment.
3. Invoices + post queue + unknown/reconcile.
4. Today + period lock.
5. Migration tool from Daftar JSON backups.
6. Nightly off-server backup.

## Proof of this phase

This file is the deliverable. No production code or deploy for Phase E.
