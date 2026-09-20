# Batch 6 — Hardening, then the road to 500 clients

You are working on **Daftar** (`pra/` in `C:\Users\Matloob\Desktop\sheikhmahboob-erp`), a React 19 + TypeScript + Dexie (IndexedDB) single-page app. A tax practitioner's office uses it to keep many clients' Punjab Revenue Authority (PRA) sales-tax invoices, POS sales, PSIDs and returns, and to post invoices to the PRA eIMS `PostData` API. It is served as static files at `https://sheikhmahboob.com/pra/`. The only server-side piece is an nginx reverse proxy at `/pra-ims/` that forwards to `https://ims.pral.com.pk/` from the VPS `187.53.143.235`, because PRA production only accepts whitelisted IPs.

An audit on 2026-09-20 found the code clean (167 tests pass, `tsc -b` clean, no `any`) but the design unsafe for real clients and unable to reach 500 clients. Your job is to fix that **in phases, in order**. Matloob, the owner, is not a specialist in this code; write every report to him in simple words, outcome first.

## Read first

1. `pra/README.md`, `pra/AGENTS.md`
2. `pra/ops/agents/PROTOCOL.md`, `pra/ops/agents/CONTRACT.md`
3. `pra/ops/agents/handoff/batch-5-done.md`
4. `pra/src/lib/ids.ts`, `pra/src/lib/money.ts`, `pra/src/lib/pra.ts`, `pra/src/domain/invoices.ts`, `pra/src/domain/ledger.ts`, `pra/src/domain/reports.ts`, `pra/src/db.ts`, `pra/src/types.ts`
5. `pra/src/pages/InvoiceEditor.tsx`, `pra/src/pages/PosSale.tsx`, `pra/src/components/LiveOpsHost.tsx`, `pra/src/components/Confirm.tsx`

Verify each finding below in the code before you change anything. Line numbers are from the audit and may have moved. If a finding turns out to be wrong, say so in your report instead of "fixing" it.

## How to work

- One phase at a time. At the end of each phase: run `npm test`, `npx tsc -b` and `npm run lint` from `pra/`, write `pra/ops/agents/handoff/batch-6-phase-N-done.md` (what changed, files, how to prove it, what is left), then **stop and wait** for Matloob to say `NEXT PHASE`.
- Test first for every money, posting and data-integrity fix: write the failing test, see it fail, then fix.
- Keep each change narrow. Match the surrounding code style. Do not refactor files you are not fixing.
- Any Dexie schema change needs a new version with an `upgrade()` step, and old backups (v4, v5) must still import.
- If something is ambiguous and the answer changes what you build, ask Matloob one clear question instead of guessing.

## Phase 1 — Correctness bugs that can put a wrong number on a tax invoice or lose data

1. **Decimal amounts cannot be typed.** Amount inputs are controlled with `value={String(n)}` and call `parseAmount` on every keystroke (`InvoiceEditor.tsx` ~534-555 and the line grid ~679-717, `PosSale.tsx` ~232-240). Typing `1.5` yields `15`. Keep the raw string in local state, parse on blur, add `inputMode="decimal"`. Cover quantity, rate, sale value, discount, extra tax, ST withheld, further tax.
2. **IDs have 32 bits of randomness.** `newId` in `lib/ids.ts` keeps 8 hex chars of a UUID and rows are written with `put`, so a collision silently overwrites another client's record. Use the full `crypto.randomUUID()` and `add` for new rows. Existing short IDs must keep working.
3. **Credit notes add to output tax.** `domain/ledger.ts` (~88-91) and `domain/reports.ts` (~74-76) sum invoice type 3 as positive. Negate it everywhere totals are built, including the Excel working papers.
4. **A logging failure turns a posted invoice into a failed one.** In `domain/invoices.ts` (~393-438) `logEvent` is awaited inside the `try` after PRA accepted; if it throws, the `catch` rewrites the invoice as `failed` and drops the fiscal number. Persist the PRA result first; logging must never change invoice state.
5. **Line discount is inert and inconsistent** (`lib/pra.ts` ~65-78, ~138). Decide with Matloob how discount affects the tax base, then make line and header values agree in the payload.
6. **Unsaved invoice is silently lost** on in-app navigation, client switch or period switch (`hooks/useUnsavedGuard.ts` only handles `beforeunload`; `InvoiceEditor.tsx` ~146-162 reloads). Autosave drafts or block navigation with a confirm.
7. **Startup failure hangs the app.** `App.tsx` ~44 has `ensureSeed().then(...)` with no catch. Show a plain error screen with an "export what can be read" option.

## Phase 2 — Double-posting and posting state

PRA has no inquiry API, so a second post of an accepted invoice can create a second fiscal invoice or strand the first one as `failed`.

1. **Remove the remote fallback in hosted builds.** `lib/pra.ts` ~454-465 posts again to `https://ims.pral.com.pk/...` after a proxy timeout or 5xx. From a browser that request fails CORS, and if it ever worked it would leave from the laptop's IP and bypass the whitelist. After a timeout or 5xx the result is **unknown**, not failed. Update `pra.test.ts` and `pra-sandbox-path.test.ts`, which currently assert the fallback.
2. **Add an `unknown` outcome and a manual reconcile action**: "I checked IRIS → IMS Fiscal Report: it was posted (enter fiscal number) / it was not posted (allow retry)". This is the only safe path without a GetData API.
3. **Stop silent auto-repost.** `components/LiveOpsHost.tsx` ~51-58 re-posts failed invoices on the `online` event, production included, matching loosely on text (`invoices.ts` ~731). Replace with a prompt that lists what would be sent; never auto-send to production.
4. **Freeze USIN and block delete once an attempt has been made** and PRA did not definitely reject it (`InvoiceEditor.tsx` ~420, `removeInvoiceDraft` ~747).
5. **Posting locks.** `sweepHungInFlight` (`db.ts` ~102, `invoices.ts` ~352) clears every lock on every tab start with no age check. Store `inFlightAt`, sweep only locks older than a few minutes, index the field. "Clear send lock" must not overwrite a row another tab just posted.
6. **Record the environment on the invoice.** Add `postedEnvironment` and the POS ID at post time. Ledger, reports, Annex C and the print must count only production posts as real; sandbox posts must print as sandbox even after the client is switched to production.
7. `PosSale.tsx` `send()` needs the same double-click guard as the editor and a `catch` that shows the error.

## Phase 3 — The `/pra-ims` proxy is an open relay

The live block in `/etc/nginx/conf.d/sheikhmahboob.conf` on the VPS is `location ^~ /pra-ims/ { proxy_pass https://ims.pral.com.pk/; ... }` with no auth, no rate limit, no method or path restriction. Anyone can send requests to PRA from the whitelisted IP. It is also **not in the repo**.

1. Commit the live `/pra` and `/pra-ims` blocks to `ops/nginx/` so the repo can rebuild the server.
2. Restrict to the two exact `PostData` paths (sandbox and production), `POST` only, `limit_req`, a same-origin `Origin`/`Referer` check, request body size cap.
3. Move the CSP from the `<meta>` tag to the nginx header, drop `script-src 'unsafe-inline'`, and restrict `ws:`/`wss:` to dev builds.
4. **Do not touch the live server.** Prepare the config and the exact deploy and rollback commands, then ask Matloob. `nginx -t` before any reload. Do not edit any nginx file other than `sheikhmahboob.conf`.

## Phase 4 — Compliance and trust

1. QR code and fiscal number on the printed invoice, and a clear "DRAFT — not a tax invoice" mark until posted. Check the POS user manual (`https://e.pra.punjab.gov.pk/templates/POS_COMPONENT_and_eIMS_User_Manual.pdf`) for what the QR must encode; do not invent a format — if the manual does not say, report that and ask.
2. A real 80 mm thermal receipt (`@page` size, 3-column layout, `afterprint` listener) and a Print button on the POS success screen.
3. Period lock: once a return is marked `filed`, invoices and purchases in that period cannot be added, edited or deleted without an explicit, logged unlock.
4. Audit trail: deleting a client must not silently destroy posted invoices and their events; `removePurchase` must be logged.
5. `Confirm` dialog: focus Cancel, trap Tab, so Enter never triggers the destructive action.
6. Plain-language errors: map known PRA codes to a next step a clerk understands; remove developer jargon ("PostData", "GetData", "in-flight", README references) from the UI. Put all UI strings in one file so Urdu can be added later.
7. Backup: stream per table instead of one `JSON.stringify`; merge import must be newest-wins, must never downgrade a `posted` invoice, must never blank a local token, must not overwrite the local PIN or selected client.

## Phase 5 — Plan only, no code: backend for 500 clients and staff

Browser-only storage cannot serve 500 clients or more than one PC. Write `pra/ops/agents/handoff/batch-6-backend-plan.md` and stop. It must cover:

- Postgres + a small API on the existing VPS (`187.53.143.235`, Ubuntu 26.04, nginx, already runs ERPNext — do not disturb it; do not install anything on the Frappe bench).
- Users, roles, client-to-staff assignment, audit log with a real actor.
- POS tokens encrypted on the server; the browser never holds them.
- Posting to PRA from the server with idempotency keyed on client + USIN, a queue, and the `unknown`/reconcile state from Phase 2.
- Schema with `period` and `[clientId+period]`, `[clientId+status]` indexes; server-side pagination and search.
- A cross-client **"Today" work queue**: one row per client with drafts, failed posts, PSID gap, return status, days to the 15th and 18th; sortable, filterable, assignable.
- Per-client monthly workflow: invoices → PSID → return filed → period locked.
- Nightly automatic off-server backups.
- A migration path from existing IndexedDB data and backup files.
- Options with cost and effort, a recommendation, and what Matloob must decide.

## Never

- Log into, scrape or automate PRA IRIS; store an IRIS password; invent PSIDs; file returns; call an undocumented GetData API.
- Post to PRA **production** from any test, script or manual check. Sandbox only, and only with a POS ID and token Matloob gives you.
- Print, log or commit tokens, passwords, PINs or anything from `server-snapshot/` or `sites/*/site_config.json`.
- Deploy (`./ops/push-pra.sh`), reload nginx, SSH to the server, run migrations on live data, commit or push — unless Matloob asks for that specific action in that message.
- Seed real taxpayers or change `shouldSeedDemoClient`.
- Claim something works without running it. If tests fail, show the failing output. If a step was skipped, say so.

## Report format at the end of every phase

Short, simple, outcome first:

1. What now works that did not before (one line each).
2. Proof: test counts, commands run, results.
3. Anything you found that contradicts this brief.
4. What is left, and what you need from Matloob.
