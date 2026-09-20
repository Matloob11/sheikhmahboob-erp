# Daftar 5-agent protocol

Repo: `C:\Users\Matloob\Desktop\sheikhmahboob-erp`  
App folder: `pra/` only (Daftar). Do **not** edit `apps/`, `pra-invoicing/`, nginx, or ERPNext.

These five agents start together. They **plan in parallel**. They **implement in order 1 → 2 → 3 → 4 → 5**. Later batches must not start coding until the previous `handoff/batch-N-done.md` exists.

## Two modes

| Mode | When | What you do |
|------|------|-------------|
| **PLAN** | Default after you are started | Read the files listed in your batch prompt. Write `handoff/batch-N-plan.md`. Do **not** edit `pra/src/**`. Then **STOP** and wait. |
| **IMPLEMENT** | Only after Matloob (or the parent chat) sends the exact signal | Read previous `handoff/batch-*-done.md` files. Edit only your owned files. Write `handoff/batch-N-done.md`. Run `npm test` and `npm run build` in `pra/`. Then **STOP**. |

If the user message does not contain `IMPLEMENT BATCH N` for **your** N, you stay in PLAN / sleep. Do not “helpfully” start coding.

## Signals (exact)

- `IMPLEMENT BATCH 1`
- `IMPLEMENT BATCH 2`
- `IMPLEMENT BATCH 3`
- `IMPLEMENT BATCH 4`
- `IMPLEMENT BATCH 5`

Wake line Matloob should paste:

```
IMPLEMENT BATCH N. Previous done files: pra/ops/agents/handoff/batch-1-done.md … batch-(N-1)-done.md. Follow your batch prompt. Do not start N+1.
```

## Sleep

After PLAN or after IMPLEMENT, reply with one short status block and stop. Do not idle-loop, do not poll git, do not implement the next batch.

Status block:

```
AGENT: N
MODE: PLAN-DONE | IMPLEMENT-DONE
HANDOFF: pra/ops/agents/handoff/batch-N-plan.md | batch-N-done.md
WAITING: IMPLEMENT BATCH N | IMPLEMENT BATCH N+1 (not me)
```

## Hard bans (every agent)

- Do not log into or scrape PRA IRIS (`inboxWorkFlowView.xhtml` or any portal).
- Do not invent official PSIDs or 1Bill payments.
- Do not file a return on IRIS.
- Do not add undocumented GetData / fiscal-inquiry APIs.
- Do not persist or print IRIS passwords.
- Do not seed **Ahmad Traders** (or any real taxpayer) into the hosted app.
- Do not change `shouldSeedDemoClient` — local demo only, hosted prod stays empty (`pra/src/lib/seed.ts`).
- Do not commit unless Matloob asks.
- Do not deploy (`./ops/push-pra.sh`) unless Matloob asks.
- Do not put secrets in git.

## File ownership (IMPLEMENT)

Do not edit another agent’s owned files. If you need a change there, write it under **Blocked / needs other batch** in your plan or done file.

| Batch | Owns |
|-------|------|
| 1 | `pra/src/domain/invoices.ts`, `invoices.test.ts`, `clients.ts` (cascade only), `returns.ts` (unique period only), `validate.ts`, `validate.test.ts`, `lib/pra.ts`, `pra.test.ts`, `lib/excel.ts` (bug fixes only), `lib/backup.ts` (deprecate `importBackup` + restore lock only), `ledger.ts` (`clientReadiness` sandbox-token flag only) |
| 2 | `pra/src/types.ts`, `db.ts`, `lib/backup.ts` (schema v5 export/import of new tables), `domain/clients.ts` (after batch 1 cascade), `buyers.ts`, `items.ts`, `catalog.ts`, `psids.ts`, `returns.ts` (new fields only), `pages/Clients.tsx`, `FirstRun.tsx`, `Buyers.tsx`, `Items.tsx`, `NeedClient.tsx` if client create path |
| 3 | `pra/src/pages/InvoiceEditor.tsx`, `Invoices.tsx`, `Returns.tsx`, `Psids.tsx`, `lib/excel.ts` (columns + IRIS import after batch 1 bugs), `lib/pra.ts` **payload extras only** if CONTRACT fields exist, `domain/invoices.ts` (editor/import hooks only after batch 1 locks) |
| 4 | `pra/src/pages/Desk.tsx`, `App.tsx`, `components/AppShell.tsx`, `CommandJump.tsx`, `InvoicePrint.tsx`, `Field.tsx`, `SearchPick.tsx`, `pages/Settings.tsx` + `settings/*` (PIN lock button / idle timeout / activity export — not backup crypto), `index.css` as needed, new report page(s) you add |
| 5 | New optional sync/PWA/ops files you add, `ops/push-pra.sh` only if Matloob later asks deploy, nginx **only** if Matloob explicitly asks, `vite.config.ts` PWA, docs in `pra/README.md` leftovers |

If two batches list the same file: **earlier batch implements first**. Later batch waits for `batch-N-done.md` then rebases its edits.

## Handoff files

Write markdown only under `pra/ops/agents/handoff/`.

### `batch-N-plan.md` (PLAN)

1. Files you will touch  
2. Exact functions / bugs  
3. Schema / API you will add (must match `CONTRACT.md` or propose a delta)  
4. Tests you will add  
5. What you will **not** do  
6. Blocked / needs other batch  

### `batch-N-done.md` (IMPLEMENT)

1. What shipped  
2. Files changed  
3. Public functions / field names (final)  
4. How to prove (`npm test`, `npm run build`)  
5. Leftovers for the next agent  

## Prove

From `pra/`:

```bash
npm test
npm run build
```

Do not treat the task done if either fails.

## Product truth

Daftar is a **local-first consultant desk** (React + Dexie). There is no Node API. Official work that stays on IRIS: login, Create Payment / 1Bill, return submit, Fiscal Report lookup.

Work **outside** these five batches is listed in `OUTSIDE-BATCHES.md`. Do not take those items unless Matloob asks.
