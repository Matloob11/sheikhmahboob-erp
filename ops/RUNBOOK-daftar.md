# Daftar runbook (simple)

For Matloob. Daftar is the PRA desk at https://sheikhmahboob.com/pra/  
ERPNext at https://sheikhmahboob.com/login is separate — do not mix them.

---

## Add a staff user

1. Open **Settings → Backup**. Sign in with the owner email/password (API).
2. Open **Settings → Staff**.
3. Enter email + temporary password → **Create staff**.
4. Under that person, click **Assign** next to each client file they may use.
5. Tell them to sign in on Settings → Backup with that email, then sync.

Disable: **Disable** on that person. They are logged out at once.  
Reset password: **Reset password** → new password → they sign in again.

---

## Switch a client to server posting

**Do not switch until PRA whitelists 187.53.143.235 and the POS is registered.**

1. Open the client → **Open go-live checklist**.
2. Complete the list (POS on portal with this IP, real token, sandbox post through the **server**).
3. When the checklist unlocks **Switch to server posting**, click it.  
   Or: Settings → Posting → **Use server** for that client.
4. Default stays **browser** for everyone else.

---

## Why an invoice failed

1. Open the invoice. Read **last error** on the form.
2. Owner: Settings → Posting → queue depth and “last error by client”.
3. Common meanings:
   - **failed** — PRA clearly rejected it (fix the data, then retry).
   - **unknown** — no clear answer (timeout/gateway). **Check IRIS** before posting that USIN again.
   - **pending** — waiting to send, or connection refused (will retry).

---

## What “unknown” means

The server (or desk) could not prove whether PRA got the invoice.  
**Do not post the same USIN again** until you check **IRIS → IMS Fiscal Report**.

- If the fiscal number is there → mark posted / enter the number.
- If it is not there → mark not posted, then retry once.

---

## If the site is down

1. Try https://sheikhmahboob.com/login and https://sheikhmahboob.com/pra/  
2. If both fail: Hostinger / VPS still up? Power?  
3. SSH (only if you asked for live help): check `systemctl status daftar-api` and `systemctl status nginx`.  
4. daftar-api should restart itself after a crash (`Restart=always`).  
5. ERP and Daftar share the box — do **not** run dangerous bench resets.

---

## Restore a daftar Postgres backup

Exact path on the VPS (asks for care — do not wipe the wrong DB):

```bash
# On the VPS as root — restore into a SCRATCH database first, not production.
# Prefer: ./ops/restore-daftar-pg-scratch.sh from your laptop (Git Bash).
```

From your laptop (repo root):

```bash
./ops/pull-daftar-pg.sh
./ops/restore-daftar-pg-scratch.sh
```

That restores into a throwaway DB for checking. **Do not** point production at a restore unless you planned a cutover.

Nightly dump on the server: `/var/backups/daftar-pg/<stamp>/` — keeps **14 days**, then deletes older folders.  
After a laptop pull, open Settings → Posting → **Mark laptop backup pulled** so the owner alert clears.

---

## Who to call

| What | Who |
|------|-----|
| PRA whitelist / POS / fiscal report | eims@pra.punjab.gov.pk · IRIS portal |
| This VPS / Hostinger box | Hostinger support (server `187.53.143.235`) |
| Daftar desk / API bugs | Your Cursor / coding session on this repo |

---

## Second off-site backup (proposal only — do not buy yet)

Laptop pull is one copy. A second target stops “laptop dies = only server left”.

| Option | Rough cost | Notes |
|--------|------------|--------|
| **Backblaze B2** | About **$0.005/GB/month** storage; ~$0.01/GB download. A 1 GB dump ≈ **under $0.01/month**. | Simple S3-compatible. Script would upload after nightly dump. |
| **Cloudflare R2** | Often **$0** for modest storage (10 GB free class); egress free to internet. | Good if you already use Cloudflare. |
| **Another Hostinger / Hetzner volume** | About **$1–4/month** for a small volume. | Keep a second VPS folder; rsync nightly. |

Recommendation when ready: **Backblaze B2 or R2** + a 5-line upload after `daftar-pg-dump`. No signup in this work — tell me when to wire it.
