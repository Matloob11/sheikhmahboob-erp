# Batch 5 — Scale + live PRA (Agent 5)

You are **Agent 5** for Daftar (`pra/`).

## Read first (in this order)

1. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\PROTOCOL.md`
2. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\ops\agents\CONTRACT.md`
3. `C:\Users\Matloob\Desktop\sheikhmahboob-erp\pra\README.md`
4. `pra/src/lib/backup.ts`
5. `pra/src/domain/settings.ts`
6. `pra/vite.config.ts`
7. `ops/push-pra.sh` (repo root) — read only until Matloob asks deploy
8. `pra/ops/agents/handoff/batch-1-plan.md` … `batch-4-plan.md`
9. Done files 1–4 **required before IMPLEMENT**

## Your job

Scale and live-ops **without** turning Daftar into an IRIS clone. Prefer in-browser first. A real Node backend only if Matloob later says so in the IMPLEMENT message.

## Default IMPLEMENT scope (browser-only)

1. Backup vault UX: scheduled **download reminder**, keep encrypt/strip; do not upload tokens to a random server.
2. Audit events: actor is `practice` until real users exist; do not wipe Batch 4 activity export.
3. PWA / installable (`vite` plugin) only if it does not break `/pra/` base path.
4. Local due reminders (15th/18th) via Notification API if permission granted — no WhatsApp stack.
5. POS fast-sale: thin route or mode that reuses InvoiceEditor domain (do not fork PostData).
6. E2E: one Playwright or vitest+fake-fetch path for sandbox Code `100` — **no** live IRIS login.
7. README leftovers: keep whitelist IP `187.52.120.196` and `/pra-ims` TLS note honest.
8. Docs: how hosted empty desk + import backup works.

## Only if IMPLEMENT message explicitly says so

- Optional sync server
- Staff roles
- nginx `/pra-ims` TLS fix
- `./ops/push-pra.sh`
- Email/WhatsApp send
- Official GetData after a cited PRA manual page

## Never

- IRIS scrape / inbox
- Invent PSIDs
- File returns on IRIS
- Seed Ahmad Traders or change `shouldSeedDemoClient`
- Print IRIS passwords
- Commit / deploy unless asked

## PLAN output

Write `pra/ops/agents/handoff/batch-5-plan.md` then STOP.  
Plan two tracks: **A browser-only (default)** and **B server (blocked)**.

## IMPLEMENT

Only after `IMPLEMENT BATCH 5` and done files 1–4 exist.  
Default = track A.  
Write `pra/ops/agents/handoff/batch-5-done.md`.  
`cd pra && npm test && npm run build`
