# Batch 7 — Finish hardening, ship to live after every phase

You are working on **Daftar** (`pra/` in `C:\Users\Matloob\Desktop\sheikhmahboob-erp`). Read
`pra/ops/agents/06-hardening.md` first: its rules, its "Never" list and its report format still
apply. This file replaces only two of its rules, on Matloob's explicit instruction:

1. **You now deploy.** After every phase that passes its checks, push the desk live so Matloob
   can look at it in the browser.
2. **You now apply the nginx change** described in Phase A, once, with the backup and rollback
   steps below.

Matloob is not a specialist in this code. Report in simple words, outcome first.

## Where things stand (2026-09-20)

- Branch `daftar-hardening`, baseline commit `7addc52`. Work on this branch. Commit at the end of
  every phase with a clear message; **do not push to any git remote**.
- Done and verified (200 tests pass, `tsc -b` clean): Batch 6 Phase 1, Phase 2, line discount
  option A (tax on sale − discount), and UI batch 1 (`/today` work queue, Confirm focus, phone
  cards, POS receipt, 80 mm page). Read `handoff/batch-6-phase-1-done.md`,
  `handoff/batch-6-phase-2-done.md`, `handoff/ui-batch-1-done.md`.
- Server: `root@187.53.143.235`, key `C:\Users\Matloob\.ssh\hostinger_srv1992968`, helper
  `./ssh.sh`. Static desk at `/var/www/pra-site/pra`. Live vhost
  `/etc/nginx/conf.d/sheikhmahboob.conf`. The same box runs ERPNext for `sheikhmahboob.com` —
  do not touch the bench, MariaDB, supervisor or any other nginx file.
- A hardened vhost is already written and syntax-tested on the server:
  repo `ops/nginx/srv1992968-sheikhmahboob.conf`, server copy `/root/sheikhmahboob.conf.new`,
  backup of the live file in `/root/nginx-backups/`. It was **not** applied yet.

## How to ship after each phase

From the repo root, only when `npm test`, `npx tsc -b` and `npm run lint` (run in `pra/`) are
clean:

```bash
./ops/push-pra.sh
```

It builds with base `/pra/`, uploads static files, runs `nginx -t`, reloads nginx and proves
`/pra/` returns 200. It never touches the ERP. After it finishes, check yourself:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/pra/      # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/login     # 200 (ERP still up)
```

If either is not 200, stop, say so plainly with the output, and do not continue to the next
phase. Tell Matloob to hard-refresh (`Ctrl+Shift+R`) because the desk has a service worker.

## Phase A — Lock the `/pra-ims` proxy (do this first)

Today anyone on the internet can send requests to PRA through `/pra-ims/` from the whitelisted
server IP. The prepared config allows only the two documented `PostData` paths (exact match),
`GET` and `POST` only, `POST` only with `Origin: https://sheikhmahboob.com`, 120 requests a minute
per IP, 256 KB body cap, strips the ERP session cookie before it reaches PRA, and returns 404 for
every other `/pra-ims` path.

1. Read `ops/nginx/srv1992968-sheikhmahboob.conf` and diff it against the live file. The only
   differences must be the `limit_req_zone` line and the `/pra-ims` blocks. If anything else
   differs, stop and report.
2. Apply with rollback in one SSH command:

```bash
B=$(ls -t /root/nginx-backups/sheikhmahboob.conf.* | head -1)
cp -a /etc/nginx/conf.d/sheikhmahboob.conf /root/nginx-backups/sheikhmahboob.conf.$(date +%Y%m%d-%H%M%S)
cp /root/sheikhmahboob.conf.new /etc/nginx/conf.d/sheikhmahboob.conf
if nginx -t; then systemctl reload nginx; echo RELOADED; else cp -a "$B" /etc/nginx/conf.d/sheikhmahboob.conf; echo ROLLED_BACK; fi
```

3. Prove every gate from your machine and paste the codes in the report:

| Request | Expect |
|---|---|
| `GET /login`, `GET /pra/` | 200 |
| `GET /pra-ims/ims/sandbox/api/Live/PostData` | 502 today (PRA refuses the IP until whitelisted) or 405 — not 404 |
| `POST` same path, no `Origin` | 403 |
| `POST` same path, `Origin: https://evil.example` | 403 |
| `POST` same path, `Origin: https://sheikhmahboob.com` | passes the gate: 502 today, a PRA JSON answer once whitelisted |
| `GET /pra-ims/ims/production/api/Live/GetData` | 404 |
| `GET /pra-ims/` | 404 |
| `DELETE` on a PostData path | 403 |

   If `/login` or `/pra/` is not 200 after the reload, restore the backup at once.
4. In the app: `src/lib/imsHealth.ts` still probes `https://ims.pral.com.pk` directly from the
   browser. Remove that remote probe (Phase 2 removed the remote post for the same reason) and
   fix the message. `src/domain/invoices.ts` ~231 still says "/pra-ims TLS are ops leftovers" —
   reword for a clerk.
5. Move the Content-Security-Policy from the `<meta>` tag in `pra/index.html` to the existing
   `add_header Content-Security-Policy` on the `^~ /pra` location. Drop `'unsafe-inline'` from
   `script-src` only if the built `index.html` has no inline script (check the build output).
   `connect-src` must be `'self'` only — no `https://ims.pral.com.pk`, no `ws:` in production.
   Same backup / `nginx -t` / rollback routine. Verify the desk still loads with no CSP errors in
   the browser console (use Playwright if available).
6. Update `ops/nginx/` so the repo file equals the live file when you finish. Update
   `pra/README.md` (proxy section) to describe the locked proxy honestly.

Ship, commit, report, then continue to Phase B without waiting.

## Phase B — Check that discount A did not rewrite history

`recalcLine` now taxes `saleValue − discount`. Before this change the line discount was ignored,
so an invoice **already posted** with a line discount was accepted by PRA with the *old* tax
figure. `src/lib/excel.ts` (~85) and any report that calls `recalcLine` on posted invoices would
now show a number PRA never saw. For posted (and `unknown`) invoices every screen, print, ledger,
report and Excel export must use the **stored** line and total values; only drafts and validated
invoices are recalculated. Write the failing test first. If this is already handled, say so and
show the test that proves it.

## Phase C — Batch 6 Phase 4 (compliance and trust)

As written in `06-hardening.md`, with these notes:

- Confirm dialog focus/Tab trap, POS "Print receipt", the 80 mm `@page` and the plain-language
  go-live checklist are **already done** — do not redo them.
- QR code: read the PRA POS manual for what the QR must encode. If it does not say, do not invent
  a format — add the fiscal number clearly, leave the QR out, and report that it needs PRA's
  answer.
- "DRAFT — not a tax invoice" on any print of an unposted invoice; "SANDBOX — test only" on any
  sandbox post.
- Period lock when a return is `filed`, with a logged, confirmed unlock.
- Deleting a client must not silently destroy posted invoices and their events: block it, or
  archive instead, and say which you chose.
- Streaming backup export; merge import newest-wins, never downgrades `posted`, never blanks a
  local token, never overwrites the local PIN or selected client.
- Plain-language PRA errors; all UI strings reachable from one file so Urdu can follow.

Ship, commit, report.

## Phase D — UI batch 2

Left over from `handoff/ui-batch-1-done.md`:

- Clients page: work-status columns (reuse `buildWorkQueue` from `src/domain/today.ts`), sort,
  pagination; client switcher with recents, a result cap and the ARIA combobox keyboard pattern.
- One stylesheet: merge `index.css` and `smc-theme.css` into a single token-based sheet, delete
  the dead dark-theme block and unused classes, replace hard-coded `#fff` with `var(--surface)`.
  Screens must look the same afterwards — compare before/after screenshots of Desk, Today,
  Invoices, Invoice editor, Clients, POS at 1280 px and 390 px.
- Split `Clients.tsx` and `InvoiceEditor.tsx` per tab / per step, no behaviour change.
- Field-level errors (`aria-invalid`, `aria-describedby`, focus the first bad field); Enter adds a
  line and arrow keys move between rows in the invoice line grid.
- Raw `YYYY-MM-DD HH:MM:SS` dates and lowercase status enums in lists → the same friendly format
  used elsewhere.
- Check the phone card layout at 390 px and the 80 mm print preview with Playwright; fix what is
  off.

Ship, commit, report.

## Phase E — Backend plan only (no code)

As Phase 5 in `06-hardening.md`: write `handoff/batch-6-backend-plan.md` and stop.

## Still never

- Post to PRA **production**, log into or scrape IRIS / `reg.pra.punjab.gov.pk`, invent PSIDs,
  call an undocumented API.
- Print, log or commit tokens, passwords, PINs, or anything from `server-snapshot/`.
- Touch the ERP bench, the database, supervisor, DNS, the firewall, or any nginx file other than
  `sheikhmahboob.conf`.
- `git push`, force operations, or `--no-verify`.
- Claim something works without running it. Failed check → show the output and stop.

## Report after every phase

1. What Matloob can now see on `https://sheikhmahboob.com/pra/` (where to click).
2. Proof: test counts, the deploy output line `PUSH_OK pra`, the HTTP codes you checked.
3. Anything that contradicted this brief.
4. What is left.
