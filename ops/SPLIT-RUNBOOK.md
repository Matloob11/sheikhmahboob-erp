# Runbook — split into two fully independent ERP instances

Goal: the ERP that currently serves `https://sheikhmahboob.com` moves to a plain
IP:port URL (to hand to its owner), and a second, completely separate instance
takes over the domain. After the cutover the two share nothing but the host OS,
the MariaDB server process, and nginx.

| | Instance A (existing, owner's) | Instance B (new) |
|---|---|---|
| Bench | `/home/frappe/frappe-bench` | `/home/frappe/frappe-bench-b` |
| URL | `http://187.127.123.235:8001` | `https://sheikhmahboob.com` |
| Web port | 8000 | 8002 |
| Socket.IO port | 9000 | 9002 |
| Redis cache / queue | 13000 / 11000 | 13001 / 11001 |
| File watcher | 6787 | 6789 |
| Site folder | `187.127.123.235` | `sheikhmahboob.com` |
| Database | `_dd4d7ef3e3991574` | `erp_b` |
| Supervisor group | `frappe-bench-*` | `frappe-bench-b-*` |

Versions to match: frappe `16.25.0` (version-16), erpnext `16.26.2` (version-16),
di `1.0.0`.

---

## Before you start

Two secrets are required and are not stored in this repo. Have them ready:

- MariaDB root password (for `bench new-site`)
- A new Administrator password for instance B

Never paste either into a commit, a chat, or a log.

### Baseline backup

Already taken on 2026-08-11:

```
/home/frappe/frappe-bench/sites/187.127.123.235/private/backups/
  20260811_230347-187_127_123_235-database.sql.gz          (1.8 MiB)
  20260811_230347-187_127_123_235-files.tar
  20260811_230347-187_127_123_235-private-files.tar
  20260811_230347-187_127_123_235-site_config_backup.json
```

To take a fresh one:

```bash
sudo -u frappe bash -lc 'cd /home/frappe/frappe-bench && bench --site 187.127.123.235 backup --with-files'
```

### Do not touch

`/opt/a7-wa`, OpenWA, n8n, `pearlzshop.conf`, `a7-*.conf`. They share this box.

---

## Step 1 — Expose instance A on port 8001 (additive, no downtime)

The nginx block is already written at `ops/nginx/sheikhmahboob-erp-ip.conf` in this
repo. Copy it to the server:

```bash
scp -i C:/Users/Matloob/.ssh/hostinger_codex \
  ops/nginx/sheikhmahboob-erp-ip.conf \
  root@187.127.123.235:/etc/nginx/conf.d/sheikhmahboob-erp-ip.conf
```

Validate and reload:

```bash
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 \
  'nginx -t && systemctl reload nginx'
```

Prove it:

```bash
curl -sS -o /dev/null -w 'ip=%{http_code}\n'    http://187.127.123.235:8001/
curl -sS -o /dev/null -w 'domain=%{http_code}\n' https://sheikhmahboob.com/
```

Both should return `200`. The domain is untouched at this point.

**Rollback:** `rm /etc/nginx/conf.d/sheikhmahboob-erp-ip.conf && systemctl reload nginx`

---

## Step 2 — Build instance B (no impact on A)

```bash
ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235
su - frappe
cd /home/frappe

bench init frappe-bench-b --frappe-branch version-16
cd frappe-bench-b
bench get-app erpnext --branch version-16
```

Copy the custom app from A rather than fetching it from GitHub, so B starts on
exactly the code A is running:

```bash
cp -a /home/frappe/frappe-bench/apps/di /home/frappe/frappe-bench-b/apps/di
cd /home/frappe/frappe-bench-b
./env/bin/pip install -e apps/di
grep -qxF 'di' sites/apps.txt || echo 'di' >> sites/apps.txt
```

Move B off A's ports before anything starts listening:

```bash
cd /home/frappe/frappe-bench-b
bench set-config -g webserver_port 8002
bench set-config -g socketio_port 9002
bench set-config -g file_watcher_port 6789
bench set-config -g redis_cache    "redis://127.0.0.1:13001"
bench set-config -g redis_queue    "redis://127.0.0.1:11001"
bench set-config -g redis_socketio "redis://127.0.0.1:13001"
bench setup redis
```

Confirm the ports actually changed before continuing:

```bash
grep -E 'port|redis' sites/common_site_config.json
```

---

## Step 3 — Create B's site and restore the data

```bash
cd /home/frappe/frappe-bench-b
bench new-site sheikhmahboob.com \
  --db-name erp_b \
  --admin-password '<NEW ADMIN PASSWORD>' \
  --mariadb-root-password '<MARIADB ROOT PASSWORD>'

bench --site sheikhmahboob.com install-app erpnext
bench --site sheikhmahboob.com install-app di
```

Restore A's data into it:

```bash
B=/home/frappe/frappe-bench/sites/187.127.123.235/private/backups/20260811_230347-187_127_123_235
bench --site sheikhmahboob.com restore "$B-database.sql.gz" \
  --with-public-files  "$B-files.tar" \
  --with-private-files "$B-private-files.tar" \
  --mariadb-root-password '<MARIADB ROOT PASSWORD>'

bench --site sheikhmahboob.com migrate
bench --site sheikhmahboob.com set-config host_name https://sheikhmahboob.com
```

### Encryption key — read this before moving on

Every Password field in the restored database (FBR `access_token`,
`pos_bearer_token`, email account passwords) is encrypted with **instance A's**
`encryption_key`. `bench restore` gives instance B a brand new key, so B cannot
decrypt any of them. `get_password()` will fail and FBR calls from B will break.

Two ways out — pick one:

1. **Copy A's key into B.** Everything keeps working immediately. The cost is that
   this one secret is shared between the two instances, so they are not 100%
   independent. Read the value from A's `site_config.json` and set it on B with
   `bench --site sheikhmahboob.com set-config encryption_key '<value>'`, then
   `bench --site sheikhmahboob.com clear-cache`.
2. **Keep the new key and re-enter every stored password by hand** in B: DI
   Settings (`access_token`, `pos_bearer_token`), POS Profile
   (`fbr_bearer_token`), and any Email Account. Fully independent, but anything
   you forget fails silently at runtime.

---

## Step 4 — Supervisor for instance B

```bash
cd /home/frappe/frappe-bench-b
bench setup supervisor --user frappe --yes
exit   # back to root
ln -sf /home/frappe/frappe-bench-b/config/supervisor.conf \
       /etc/supervisor/conf.d/frappe-bench-b.conf
supervisorctl reread
supervisorctl update
supervisorctl status | grep frappe-bench-b
```

Every program name must start with `frappe-bench-b-`. If any of them collide with
A's `frappe-bench-*` names, stop and fix the generated config before continuing —
a collision will take instance A down.

Check B answers locally before touching the domain:

```bash
curl -sS -o /dev/null -w 'B=%{http_code}\n' -H 'Host: sheikhmahboob.com' http://127.0.0.1:8002/
```

---

## Step 5 — Cutover (the only step with user-visible impact)

Everything above is additive. This step moves the domain. Do it in a quiet window.

Back up the current domain config first:

```bash
cp /etc/nginx/conf.d/sheikhmahboob-erp.conf \
   /root/sheikhmahboob-erp.conf.pre-split-$(date +%Y%m%d%H%M%S)
```

Then, in `/etc/nginx/conf.d/sheikhmahboob-erp.conf`, repoint the domain at B:

- `upstream sheikh_erp_frappe`   → `server 127.0.0.1:8002 fail_timeout=0;`
- `upstream sheikh_erp_socketio` → `server 127.0.0.1:9002 fail_timeout=0;`
- `root` → `/home/frappe/frappe-bench-b/sites`
- every `X-Frappe-Site-Name` → `sheikhmahboob.com`
- every `try_files /187.127.123.235/...` → `try_files /sheikhmahboob.com/...`

Leave all `# managed by Certbot` lines exactly as they are — the existing
certificate already covers `sheikhmahboob.com` and `www.sheikhmahboob.com` and
stays valid.

Point instance A at its new URL:

```bash
sudo -u frappe bash -lc 'cd /home/frappe/frappe-bench && \
  bench --site 187.127.123.235 set-config host_name http://187.127.123.235:8001 && \
  bench --site 187.127.123.235 clear-cache'
```

A's `site_config.json` also has a `domains` key still listing the old domain.
Inspect it and clear it if it names `sheikhmahboob.com`.

Apply:

```bash
nginx -t && systemctl reload nginx
```

---

## Step 6 — Verify

```bash
curl -sS -o /dev/null -w 'A_ip=%{http_code}\n'  http://187.127.123.235:8001/
curl -sS -o /dev/null -w 'B_dom=%{http_code}\n' https://sheikhmahboob.com/
```

Both `200`. Then confirm they are genuinely separate:

- Log into each and change something trivial in one; it must not appear in the other.
- `supervisorctl status` shows two independent program groups.
- `ss -tlnp | grep -E '8000|8002|9000|9002|11000|11001|13000|13001'` shows both
  sets of ports listening.

### Rollback

```bash
cp /root/sheikhmahboob-erp.conf.pre-split-<timestamp> /etc/nginx/conf.d/sheikhmahboob-erp.conf
sudo -u frappe bash -lc 'cd /home/frappe/frappe-bench && \
  bench --site 187.127.123.235 set-config host_name https://sheikhmahboob.com && \
  bench --site 187.127.123.235 clear-cache'
nginx -t && systemctl reload nginx
```

Instance B keeps running on 8002 and does no harm while stopped out of the path;
to silence it entirely: `supervisorctl stop 'frappe-bench-b-*'`.

---

## Soft-reset domain to fresh client + software masters

If domain B accidentally has old client data, or you need a clean company on the
domain while keeping HS codes / UOMs / SRO masters from A:

```bash
# as root on the VPS
bash /path/to/ops/fix-domain-fresh-with-masters.sh
```

`mysqldump` **must** use `--complete-insert`. A and B can have the same columns
in a different physical order (seen on `tabHS Code` and `tabTax Item` after
different Frappe/DI patch levels). A positional `REPLACE` puts description text
into `_assign` / `_liked_by`; Desk list view then dies with
`json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`.

One-off repair (without recreating the site):

```bash
mysqldump -u root -p"$DBROOT" --single-transaction --quick --skip-triggers \
  --no-create-info --replace --complete-insert \
  _dd4d7ef3e3991574 'tabHS Code' 'tabTax Item' > /tmp/fix-named.sql
mariadb -u root -p"$DBROOT" erp_b -e \
  'SET FOREIGN_KEY_CHECKS=0; TRUNCATE `tabHS Code`; TRUNCATE `tabTax Item`; SET FOREIGN_KEY_CHECKS=1;'
mariadb -u root -p"$DBROOT" erp_b < /tmp/fix-named.sql
sudo -u frappe bash -lc 'cd /home/frappe/frappe-bench-b && bench --site sheikhmahboob.com clear-cache'
```

---

## Known consequences

- **The owner's URL changes.** `http://187.127.123.235:8001` is plain HTTP with no
  certificate, so logins travel in cleartext. Bookmarks, saved links, and any
  invoice emails already sent that point at `sheikhmahboob.com` will land on
  instance B instead of the owner's data. Consider giving instance A its own
  subdomain with a certificate later.
- **Both instances carry FBR production credentials** and are configured for
  Production mode. Either one can post real, non-reversible invoices to the FBR
  portal. Duplicate submissions from the two instances are possible.
- Port 8001 is reachable from the public internet; `ufw` is inactive and the
  iptables INPUT policy is ACCEPT.
- After the split, `ops/push-app.sh` still targets instance A only. Deploying to
  instance B needs its own script or an edited `BENCH` value in `ops/_common.sh`.
