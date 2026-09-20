# Batch 5 done — Scale + live PRA

Agent 5. IMPLEMENT complete. Track **A (browser-only)** only. Rebased on `batch-1-done.md` … `batch-4-done.md`. Did not start Track B.

## 1. What shipped

- Backup download reminder (7 days / never exported + has clients). Encrypt/strip unchanged. No upload. `Backup.tsx` dispatches `daftar:backup-exported` after a successful export. Banner can mark downloaded or snooze 3 days.
- Audit actor stays implicit **practice**. Batch 4 activity export / `ActivityList` not wiped or rewritten.
- Installable desk: `manifest.webmanifest` + `public/sw.js`. Live `PRA_LIVE_BASE=1` build keeps `src="/pra/assets/"` and sets manifest `start_url` / `scope` to `/pra/`. SW does not cache `/pra-ims` or `ims.pral.com.pk`. Not an offline post queue. Did **not** add `vite-plugin-pwa`.
- 15th / 18th due reminders via Notification API after a click. No WhatsApp / email.
- `/pos` fast cash sale uses `emptyInvoice` → `saveInvoiceDraft` → `submitInvoice` (same PostData path). Walk-in defaults to end consumer when there is no PNTN.
- Vitest + fake `fetch` for sandbox Code `100` (proxy ok, 502 fallback, Code `101` + fiscal not posted). No live IRIS.
- README: success is Code `100` / `00` only; whitelist IP `187.52.120.196` and `/pra-ims` TLS leftovers stay honest; hosted empty desk + import backup documented.

## 2. Files changed

**New**

- `pra/src/domain/reminders.ts`, `reminders.test.ts`
- `pra/src/domain/dueNotify.ts`, `dueNotify.test.ts`
- `pra/src/components/LiveOpsHost.tsx`
- `pra/src/pages/PosSale.tsx`
- `pra/src/lib/pra-sandbox-path.test.ts`
- `pra/src/lib/pwa.ts`
- `pra/public/sw.js`, `pra/public/manifest.webmanifest`

**Owned / one-line mounts after Batch 4**

- `pra/src/main.tsx` — `registerDaftarPwa()`
- `pra/src/App.tsx` — `/pos` route + `LiveOpsHost`
- `pra/src/components/AppShell.tsx` — POS in Work / More
- `pra/src/domain/commandJump.ts` — POS sale jump
- `pra/src/pages/settings/Backup.tsx` — `daftar:backup-exported`
- `pra/vite.config.ts` — emit live-aware manifest
- `pra/index.html` — manifest link
- `pra/README.md`

Did not edit `lib/pra.ts`, `lib/backup.ts` crypto/version, `types.ts`, `db.ts`, `seed.ts`, nginx, or `ops/push-pra.sh`.

## 3. Public functions / field names (final)

| Name | Module |
|------|--------|
| `BACKUP_REMIND_DAYS` (7), `BACKUP_EXPORTED_EVENT` | `reminders.ts` |
| `markBackupExported`, `recordBackupExport`, `snoozeBackupReminder`, `backupReminderState` | `reminders.ts` |
| `dueNotifyCandidates`, `shouldFireDueNotify`, `markDueNotifyFired` | `dueNotify.ts` |
| `requestDueNotifyPermission`, `fireDueNotify` | `dueNotify.ts` |
| `registerDaftarPwa` | `pwa.ts` |
| `PosSalePage` | `pages/PosSale.tsx` |
| `LiveOpsHost` | `components/LiveOpsHost.tsx` |

Browser keys: `daftar-backup-last-export`, `daftar-backup-snooze-until`, `daftar-due-notify-fired`.  
No Dexie bump. No CONTRACT-DELTA. Actor field not added (`DeskEvent` still has no `actor`).

## 4. How to prove

From `pra/`:

```bash
npm test
npm run build
```

This run: **145 tests passed**, `tsc -b && vite build` succeeded.

Live-base gate (not a deploy): `PRA_LIVE_BASE=1 npx vite build --outDir .live-dist-test` → `index.html` has `src="/pra/assets/"`, no `Program Files`, manifest `start_url` is `/pra/`. Temp folder deleted.

## 5. Leftovers

**Track B / Matloob (not shipped)**

- Production IP whitelist for `187.52.120.196` — not approved.
- VPS → `ims.pral.com.pk` TLS (`SSL_ERROR_SYSCALL` / `/pra-ims` 502). App still falls back to the remote PRA URL.
- `./ops/push-pra.sh`, nginx TLS, sync server, staff roles, email/WhatsApp, GetData.
- First live production invoice + IRIS Fiscal Report check.

**Still other owners**

- `ledger.psidPaid` still sums `amount` (Batch 3 leftover).
- `clientReadiness` still says `"PNTN missing"` for CNIC-as-registration (`validate.ts` is Batch 1).
- InvoiceEditor line `name=` / skeletons (Batch 4 leftover).
- Offline post queue / thermal / official PRA QR (Batch 4 leftover; PWA is install-only).
