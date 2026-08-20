# Move to the new VPS — DONE 2026-08-20

`sheikhmahboob.com` and `www.sheikhmahboob.com` now serve from **187.52.120.196**.
Verified live: `/`, `/login`, `/app`, `/assets/...`, `/files/...`, `/robots.txt`
and `www` all answer 200 from the new IP, `http://` redirects, and the
certificate validates with 81 days left.

Two things surfaced only after the DNS change, both fixed:

- **The ACME account had not been copied.** The certificate itself worked, so
  nothing looked wrong — but `certbot renew --dry-run` failed with "You should
  register before running non-interactively", meaning the November renewal would
  have failed quietly. `/etc/letsencrypt/accounts` was copied from the old box
  and the dry run now succeeds.
- **`/home/frappe` was `drwxr-x---`**, so nginx (`www-data`) could not traverse
  it and every static file returned 404 with `stat() failed (13: Permission
  denied)` in the error log — assets, the logo and robots.txt. Fixed with
  `chmod o+x /home/frappe`, which allows traversal without allowing the
  directory to be listed.

Steps 1 and 2 below are kept as the record of how it was done.

## Where things stand

| | Old VPS | New VPS |
|---|---|---|
| IP | 187.127.123.235 | **187.52.120.196** |
| Host | srv1802669 | srv1913188 |
| Bench | `/home/frappe/frappe-bench-b` | `/home/frappe/frappe-bench` |
| Ports | 8002 / 9002, redis 13001 / 11001 | 8000 / 9000, redis 13000 / 11000 |
| SSH key | `hostinger_codex` | `hostinger_ed25519` |
| CPU / RAM | 8 cores / 32 GB (shared with other stacks) | 2 cores / 8 GB (this alone) |
| gunicorn workers | 5 | 3 |
| Serving the domain | yes, right now | not yet |

frappe 16.31.0 on both. erpnext 16.32.3 on the new box against 16.31.1 on the
old — `version-16` moved on between the two builds; `bench migrate` has already
run against the restored data.

The new box hosts this instance only. The other party's instance
(`187.127.123.235:8001`) was not touched and stays where it is.

## What was verified before asking you to move DNS

Tested with `curl --resolve`, which sends the real hostname to the new IP without
changing DNS:

- `https://sheikhmahboob.com/` → 200, certificate verified
- `/login` → 200, `http://` → 301
- Every record count identical to the old box: 11 Sale Tax Invoices (10 submitted,
  all carrying their FBR number), 11 Tax Items, 7,803 HS Codes, 378 DI Logs
- The seller's FBR token decrypts on the new box — the site's `encryption_key`
  was carried across, without which every stored password would have been lost
- FBR reachable from the new IP: a sandbox validate returns **Valid**
- All 41 app tests pass

The certificate was copied from the old server before the move, so HTTPS works
from the instant DNS changes rather than breaking until certbot can run. It is
valid to 9 November 2026 and `certbot.timer` is enabled on the new box.

## The DNS step (done)

At GoDaddy (`ns57`/`ns58.domaincontrol.com`), change the A records:

| Host | From | To |
|---|---|---|
| `@` | 187.127.123.235 | **187.52.120.196** |
| `www` | 187.127.123.235 | **187.52.120.196** |

Lower the TTL an hour beforehand if you want the switch to take effect quickly.

Check it has taken:

```powershell
nslookup sheikhmahboob.com 8.8.8.8
curl.exe -sS -o NUL -w "%{http_code}`n" https://sheikhmahboob.com/
```

## If something looks wrong

Point the A records back at `187.127.123.235`. The old instance is still running
and still holds the same data, so reverting is only a DNS change.

## After it is confirmed working

1. Stop the old instance so nobody edits data on a server nobody is looking at:
   `supervisorctl stop 'frappe-bench-b-*'` on the old box.
2. Leave it stopped for a few days before deleting anything.
3. The old `sheikhmahboob-erp.conf` on the old box can then be removed — but
   leave `sheikhmahboob-erp-ip.conf` alone, it serves the other party's instance
   on port 8001.

## Still outstanding, unrelated to the move

- MariaDB root password and the Administrator password on the **old** box were
  exposed in chat. The new box has its own root password, generated on the
  server and stored in `/root/.mariadb_root_password` (mode 600); it has never
  been printed. The Administrator password came across with the restore, so it
  is the same one as before and is still worth changing.
- FBR production use needs the new IP whitelisted in the FBR portal. Sandbox
  works from it already.
