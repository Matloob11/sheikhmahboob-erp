# Batch 5 plan — Scale + live PRA

Agent 5. **PLAN only.** No `pra/src` edits in this mode.

Written 2026-09-18 against `PROTOCOL.md`, `CONTRACT.md`, `05-scale.md`, current `pra/src`, `pra/README.md`, `ops/push-pra.sh`, and handoff `batch-1-plan.md` / `batch-2-plan.md` / `batch-3-plan.md`.  
`handoff/batch-4-plan.md` was **not present**. Done files `batch-1-done.md` … `batch-4-done.md` do **not** exist yet.

**Default IMPLEMENT = Track A (browser-only).** Track B stays blocked unless the `IMPLEMENT BATCH 5` message names a B item.

Re-read all `handoff/batch-*-plan.md` and `batch-*-done.md` before coding. Rebase names if Batch 2 shipped a CONTRACT-DELTA (their plan currently has none).

---

## Tracks

| Track | When | What |
|-------|------|------|
| **A — browser-only (default)** | `IMPLEMENT BATCH 5` after done files 1–4 | Backup download reminder, implicit `practice` actor, optional PWA if `/pra/` stays intact, 15th/18th Notification API, thin POS sale page, vitest+fake-fetch sandbox Code `100`, README leftovers + hosted-empty-desk docs |
| **B — server / ops (blocked)** | Only if IMPLEMENT text explicitly names the item | Sync server, staff roles, nginx `/pra-ims` TLS, `./ops/push-pra.sh`, email/WhatsApp, official GetData |

---

## 1. Files I will touch (Track A IMPLEMENT)

Owned / new (Batch 5):

| File | Why |
|------|-----|
| `pra/src/domain/reminders.ts` | **New.** Backup-download cadence. localStorage only (see schema). |
| `pra/src/domain/reminders.test.ts` | **New.** Due / snooze / mark-exported. |
| `pra/src/domain/dueNotify.ts` | **New.** 15th payment / 18th return using existing `dueInstants`. Notification API. Dedup key. |
| `pra/src/domain/dueNotify.test.ts` | **New.** Calendar + once-per-due-key. |
| `pra/src/components/LiveOpsHost.tsx` | **New.** Banner: backup overdue + due-notify permission. No Desk/AppShell rewrite. |
| `pra/src/pages/PosSale.tsx` | **New.** Fast cash sale. Calls existing `emptyInvoice` / `saveInvoiceDraft` / `submitInvoice`. Does **not** call `postInvoice` itself. |
| `pra/src/lib/pra-sandbox-path.test.ts` | **New.** Fake-fetch sandbox Code `100` path (not live PRA). |
| `pra/src/main.tsx` | Unowned. Mount `<LiveOpsHost>` around `<App />` so reminders work without editing Batch 4 `App.tsx`. |
| `pra/vite.config.ts` | PWA plugin **only if** `PRA_LIVE_BASE=1` still emits `/pra/assets/` and SW does not cache `/pra-ims`. If that fails in a local build, **drop the plugin** (leftover, do not ship a broken base). |
| `pra/package.json` | `vite-plugin-pwa` only if the PWA gate above passes. No Playwright unless vitest path is impossible. |
| `pra/README.md` | Leftovers stay honest. Align success wording with Batch 1. Hosted empty desk + import backup. |

I will **not** edit Batch 1–4 owned files in Track A except the leftovers listed in §6 (one-line mounts). If those mounts are missing after done files exist, POS route and Settings copy stay leftovers — I do not take `App.tsx`, `AppShell.tsx`, `Backup.tsx`, `types.ts`, `db.ts`, `lib/backup.ts`, or `lib/pra.ts`.

`ops/push-pra.sh` and nginx: **read only** unless IMPLEMENT explicitly asks deploy / TLS.

---

## 2. Exact functions / bugs (Track A)

### Backup vault reminder

Today (`Backup.tsx`): export encrypts or strips tokens; import previews then `applyBackup`. Exports are **not** logged. No “download again” cadence. Tokens must not go to a random server (already true).

I will add (new module, no backup crypto change):

| Function | Role |
|----------|------|
| `BACKUP_REMIND_DAYS` | Default `7`. |
| `readBackupExportAt()` / `markBackupExported(at = Date.now())` | `localStorage` key `daftar-backup-last-export`. |
| `backupReminderState(now)` | `{ due: boolean, lastAt?: number, daysOverdue: number }`. Due if never exported **and** at least one client exists, or last export older than 7 days. |
| `snoozeBackupReminder(days, now)` | Key `daftar-backup-snooze-until`. |
| `recordBackupExport()` | Called from `LiveOpsHost` via `window` custom event `daftar:backup-exported` **or** from a leftover one-liner in `Backup.tsx` after `exportBackup` succeeds. |

`LiveOpsHost` banner: “Download a desk backup (encrypt tokens or strip). This browser does not upload the file.” Button jumps via `sectionPath("/settings")` + hash `#backup`. Never upload JSON. Never invent a vault server.

Do **not** bump `DeskBackup.version` (Batch 2 → v5). Do **not** reintroduce `importBackup`.

### Audit actor = `practice`

`logEvent` today has no `actor`. Batch 2 plan does not add `DeskEvent.actor`. Batch 4 will raise the activity cap and CSV-export events.

Track A:

- Treat every existing `DeskEvent` as authored by the **practice** (single-operator desk). No staff table.
- Do **not** wipe, truncate, or replace Batch 4 activity export (`ActivityList.tsx` is Batch 4).
- Do **not** add `EventKind` values that Batch 2/4 did not ship.
- If Batch 2 done file already has `DeskEvent.actor?: "practice"`, I will default it in a **new** wrapper `logPracticeEvent` used only by my new pages — I will not rewrite every Batch 1–3 `logEvent` call.

### PWA / installable

`vite.config.ts` already uses `base: PRA_LIVE_BASE === "1" ? "/pra/" : "/"`. Git Bash must not see `--base=/pra/`.

If `vite-plugin-pwa` is added:

- `base` stays the env flag (no CLI `--base`).
- Live: `scope` + `start_url` = `/pra/`. Local: `/`.
- Workbox: `NetworkOnly` (or exclude) `/pra-ims` and `ims.pral.com.pk`. Do not cache PostData.
- After a trial `PRA_LIVE_BASE=1` vite build, `index.html` must contain `src="/pra/assets/"` and must not contain `Program Files`. Fail → remove plugin, document leftover.

### Local due reminders (15th / 18th)

`dueInstants(period)` already: payment = 15th of next month, return = 18th of next month (`lib/ids.ts`, PRA calendar).

| Function | Role |
|----------|------|
| `dueNotifyCandidates(period, now)` | Payment due today or overdue; return due today or overdue. Uses `calendarDaysUntil`. |
| `dueNotifyKey(period, kind, dayStamp)` | Dedup. |
| `shouldFireDueNotify(period, now)` | True if candidate and key not in `daftar-due-notify-fired`. |
| `requestDueNotifyPermission()` | `Notification.requestPermission()` only after a click on `LiveOpsHost`. |
| `fireDueNotify(period, now)` | `new Notification(...)` if `permission === "granted"`. Body: working paper / PSID on this desk — **not** “IRIS filed” / “1Bill created”. |

No WhatsApp. No email. No service-worker push server. Desktop Notification API only. Quiet if permission is default/denied.

### POS fast-sale

New page, not a fork of `InvoiceEditor.tsx` (Batch 3).

Flow:

1. Require selected client (reuse `NeedClient`).
2. One catalog/PCT line: name, qty, sale value (ex-ST). `recalcLine` + `totalsFromItems`.
3. Buyer optional (walk-in / end consumer). If Batch 2 `buyerType` exists, default `end_consumer` when no PNTN.
4. `paymentMode = 1` (Cash). `invoiceType = 1`.
5. `saveInvoiceDraft` then `submitInvoice(client, invoice)` — same Batch 1 gate / inFlight / success codes.
6. Show `postedMessage` / fiscal / Code. Sandbox `Not Available` is OK only with Code `100`/`00` (Batch 1 rule).

No second PostData client. No GetData. Route `/pos` is a Batch 4 leftover (see §6). Until that route exists, the page file ships unused.

### E2E (no live IRIS)

Prefer **vitest + fake `fetch`** (Playwright not in `package.json`; do not add it on Track A).

`pra-sandbox-path.test.ts`:

1. Mock `fetch`: first URL `/pra-ims/ims/sandbox/api/Live/PostData` returns JSON `{ Code: "100", InvoiceNumber: "Not Available", Response: "OK" }`.
2. `postInvoice(sandboxClient, payload)` → `ok: true`, `kind: "success"`.
3. Second case: proxy returns HTML/502 → fallback remote URL; fake remote Code `100` → still `ok`.
4. Third: Code `101` + a fiscal-looking number in the body → `ok: false` (Batch 1 rule).

Do **not** hit `ims.pral.com.pk` or IRIS. Do **not** edit `pra.test.ts` unless a done-file leftover requires it (that file is Batch 1).

### README leftovers (keep honest)

Keep, do not mark shipped:

1. Production IP whitelist for **187.52.120.196** — **not** approved. Email body to `eims@pra.punjab.gov.pk` stays.
2. VPS → `ims.pral.com.pk` TLS (`SSL_ERROR_SYSCALL` / nginx 502 on `/pra-ims`). App already falls back to the remote PRA URL. Do not claim the handshake is fixed.
3. Real POS token vs demo `100000` + published sandbox token.
4. First live production invoice + IRIS Fiscal Report check.

**Batch 1 leftover I will fix in README:** success is Code `100` or `00` (sandbox may still show `InvoiceNumber: "Not Available"`). A lone fiscal that is not `"Not Available"` is **not** enough if the body is an error. Remove/replace the current looser line “or a real fiscal `InvoiceNumber`”.

### Hosted empty desk + import

Document in README (facts already in code):

- Hosted `https://sheikhmahboob.com/pra/` is `import.meta.env.PROD` → `shouldSeedDemoClient` is false → empty settings, **no** Demo Traders.
- Settings → Import backup → preview counts → Replace or Merge by id.
- Encrypted vault needs the backup password (not the practice PIN unless they chose the same string).
- After restore, if the backup settings include a practice PIN, the desk locks (Batch 1 `applyBackup` + Settings UI).
- Batch 2 v5 files also carry places / banks / POS devices; v4 files still import (empty new arrays).
- This is how a consultant moves a local file onto the hosted desk. Do not seed Ahmad Traders or any real taxpayer.

---

## 3. Schema / API I will add

**No CONTRACT-DELTA.** No Dexie bump (Batch 2 owns v4 + backup v5). No new tables.

Browser keys (not Dexie, not backup JSON):

| Key | Value |
|-----|--------|
| `daftar-backup-last-export` | `number` (ms) |
| `daftar-backup-snooze-until` | `number` (ms) |
| `daftar-due-notify-fired` | JSON string array of notify keys |

Public functions (new modules only):

```ts
markBackupExported(at?: number): void
backupReminderState(now: Date, hasClients: boolean): { due: boolean; lastAt?: number; daysOverdue: number }
snoozeBackupReminder(days: number, now?: Date): void

dueNotifyCandidates(period: string, now?: Date): Array<{ kind: "payment" | "return"; days: number }>
shouldFireDueNotify(period: string, now?: Date): boolean
requestDueNotifyPermission(): Promise<NotificationPermission>
fireDueNotify(period: string, now?: Date): boolean
```

POS page is UI over existing domain. No new PostData fields. No GetData.

If Batch 2 later adds Settings fields (`lastBackupExportedAt`, `dueNotifyEnabled`), I may **read** them after rebase. I will not add those fields myself (`types.ts` is Batch 2).

Out of contract (still out): IRIS login, passwords, GetData client.

---

## 4. Tests I will add

| Case | File |
|------|------|
| No export + has clients → reminder due | `reminders.test.ts` |
| Export 8 days ago → due; 2 days ago → not due | `reminders.test.ts` |
| Snooze 3 days suppresses due | `reminders.test.ts` |
| Period `2026-09` → payment 15 Oct 2026, return 18 Oct 2026 | `dueNotify.test.ts` (via `dueInstants`) |
| Same due key does not fire twice | `dueNotify.test.ts` |
| Fake fetch sandbox Code `100` + `Not Available` → `postInvoice` ok | `pra-sandbox-path.test.ts` |
| Proxy HTML/502 then remote Code `100` → ok | `pra-sandbox-path.test.ts` |
| Code `101` + fiscal in body → not ok | `pra-sandbox-path.test.ts` |

No Playwright on Track A.  
Prove on IMPLEMENT: `cd pra && npm test && npm run build`.

PWA gate (manual, same IMPLEMENT): `PRA_LIVE_BASE=1 npx vite build --outDir .live-dist-test` and grep `src="/pra/assets/"` / no `Program Files`. Delete that outDir. Not a deploy.

---

## 5. What I will not do

- Implement before `IMPLEMENT BATCH 5` **and** `handoff/batch-1-done.md` … `batch-4-done.md`.
- Track B items unless the IMPLEMENT message names them.
- Batches 1–4 work (integrity, client file, invoice editor, desk chrome).
- Edit `pra.ts` transport / success map (`postInvoice`, `interpretPraPost`) — only a new fake-fetch test file.
- Edit `lib/backup.ts` crypto, version, or `importBackup` (Batch 1 + 2).
- Change `shouldSeedDemoClient` or seed Ahmad Traders / any real taxpayer.
- IRIS scrape, inbox, file a return, invent PSIDs / 1Bill, GetData, print IRIS passwords.
- WhatsApp / email send (no A7 stack).
- Upload backups or tokens to a server.
- Commit or `./ops/push-pra.sh` unless Matloob asks.
- Fake whitelist approval or TLS-fixed `/pra-ims`.

---

## 6. Blocked / needs other batch

**Protocol gate:** do not implement until done files 1–4 exist.

| Need | Who | Why |
|------|-----|-----|
| Integrity + PRA codes | Batch 1 | POS sale and sandbox path test assume `submitInvoice` / Code `100`/`00` only. README leftover they assigned to me. |
| Dexie v4 + backup v5 | Batch 2 | Import docs mention places/banks/devices. I do not bump schema. |
| `sweepHungInFlight` in `ensureSeed` | Batch 2 (`db.ts`) | Batch 1 leftover. I do not edit `db.ts`. |
| Invoice extras / buyerType on disk | Batch 2 + 3 | POS page copies `end_consumer` only if the field exists; otherwise walk-in with empty PNTN. |
| `handoff/batch-4-plan.md` + `batch-4-done.md` | Batch 4 | Required before IMPLEMENT. Activity CSV must survive. |
| Route `pos` + CommandJump “POS sale” | Batch 4 (`App.tsx`, `CommandJump.tsx`, optional `AppShell` WORK) | I ship `PosSale.tsx`. They mount `<Route path="pos" element={<PosSalePage />} />` and `sectionPath("/pos")`. |
| One line after `exportBackup` | Batch 4 (`Backup.tsx`) | `window.dispatchEvent(new Event("daftar:backup-exported"))` so the reminder clock resets. If missing, user can still mark from `LiveOpsHost` after a successful export they confirm. |
| Do not hide `#backup` / encrypt-strip radios | Batch 4 | I do not rewrite Settings. |
| nginx TLS / whitelist / deploy | Matloob + Track B | Not Track A. |

---

## Track B (blocked) — only if IMPLEMENT names it

| Item | Why blocked |
|------|-------------|
| Optional sync server | Product is local-first; no Node API. Would be a new service, auth, and token handling. |
| Staff roles | No user table. Actor stays `practice`. |
| nginx `/pra-ims` TLS | VPS handshake to `ims.pral.com.pk` fails (`SSL_ERROR_SYSCALL` / 502). Needs PRA network/whitelist or OpenSSL debug on the VPS. File: `/etc/nginx/conf.d/sheikhmahboob.conf` only, backup first. Not this PLAN. |
| `./ops/push-pra.sh` | Deploy. Do not run unless asked. Script already builds `PRA_LIVE_BASE=1`, checks `/pra/assets/`, `nginx -t`, reload only. |
| Email / WhatsApp send | Hard ban. Not the A7 inbox repos. |
| Official GetData | POS manual documents **PostData only**. No cited inquiry API → do not invent. |

---

## IMPLEMENT gate (later)

Wait for a message that contains exactly `IMPLEMENT BATCH 5`.  
Then confirm `pra/ops/agents/handoff/batch-1-done.md` through `batch-4-done.md` exist.  
Ship Track A. Write `pra/ops/agents/handoff/batch-5-done.md`.  
`cd pra && npm test && npm run build`. Stop.
