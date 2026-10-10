# Sheikh Mahboob ERP (Frappe / ERPNext)

Self-contained copy of the live ERP apps. **Not related to the A7 WhatsApp / OpenWA project.**

| | |
|---|---|
| Live URL | https://sheikhmahboob.com |
| VPS | Hostinger `root@187.53.143.235` (`srv1992968`) |
| Bench path on server | `/home/frappe/frappe-bench` |
| Site name on server | `sheikhmahboob.com` |
| Domains | `sheikhmahboob.com`, `www.sheikhmahboob.com` |
| Apps | `frappe` 16.31.0, `erpnext` 16.32.3, `di` 1.0.0 |
| SSH key (this machine) | `C:\Users\Hp\.ssh\hostinger_187_53_143_235` (fallback: `C:\Users\Matloob\.ssh\hostinger_srv1992968`) |

---

## Folder layout (local)

```
sheikhmahboob-erp/
  README.md          ← you are here (agents: read this first)
  AGENTS.md          ← short rules for AI agents
  ssh.sh             ← open an SSH shell on the VPS
  ops/
    pull-apps.sh     ← download apps from VPS → this folder
    push-app.sh      ← upload one local app → VPS + restart
    push-pra.sh      ← build + upload Daftar static files to /pra (not ERP)
    remote-update.sh ← on-server: bench update / migrate (via SSH)
  pra/               ← Daftar (PRA eIMS / POS desk). See pra/README.md
  apps/
    frappe/
    erpnext/
    di/              ← custom business app (edit this most often)
    di.backup.*/     ← old backup tree; do not deploy blindly
  config/            ← bench-generated nginx/supervisor snippets (reference)
  sites/
    apps.txt
    apps.json
    common_site_config.json
  Procfile
```

**Not in this folder (on purpose):** Python `env/`, MariaDB data, site files, secrets (`site_config.json` with DB password). Those stay only on the VPS.

**Daftar** (`pra/`) is a separate local-first PRA desk at https://sheikhmahboob.com/pra/. It is not an ERPNext app. Do not use `./ops/push-app.sh di` for it.

---

## 1) SSH into Hostinger

From this folder (Git Bash / WSL / Ubuntu):

```bash
./ssh.sh
```

Or manually:

```bash
ssh -i /mnt/c/Users/Hp/.ssh/hostinger_187_53_143_235 \
  -o IdentitiesOnly=yes \
  root@187.53.143.235
```

Windows PowerShell:

```powershell
ssh -i C:\Users\Hp\.ssh\hostinger_187_53_143_235 -o IdentitiesOnly=yes root@187.53.143.235
```

Site-less DI tests on this machine (WSL Ubuntu, no Windows `.venv`):

```powershell
wsl -d Ubuntu -- bash /mnt/c/Users/Hp/Desktop/sheikhmahboob-erp/ops/run-tests-wsl.sh
```

Then:

```bash
su - frappe
cd /home/frappe/frappe-bench
bench version
```

Nginx vhost:

- `/etc/nginx/conf.d/sheikhmahboob.conf`
- SSL: Let's Encrypt `sheikhmahboob.com`

---

## 2) Update / upgrade on Hostinger (live)

Always work as user `frappe` inside the bench. Prefer backing up first.

### A) Safe custom-app deploy (most common)

On your laptop, edit `apps/di` (or other app), then from this folder:

```bash
./ops/push-app.sh di
```

That rsyncs `apps/di` → server, then on server runs `bench --site sheikhmahboob.com migrate` and `bench restart`.

### B) Full framework / ERPNext upgrade (careful — downtime)

```bash
./ops/remote-update.sh
```

Or by hand over SSH:

```bash
su - frappe
cd /home/frappe/frappe-bench
bench switch-to-branch version-16   # only if you intentionally change branch
bench update --reset               # pulls frappe + erpnext; can break custom apps
bench --site sheikhmahboob.com migrate
bench restart
```

**Before `bench update`:**

```bash
# as root
cd /home/frappe
tar -czf frappe-bench-backup-$(date +%Y%m%d).tgz frappe-bench/apps frappe-bench/sites
# MariaDB dump (example)
mysqldump -u root -p --all-databases > /root/erp-db-$(date +%Y%m%d).sql
```

### C) Clear cache / restart only

```bash
su - frappe -c 'cd /home/frappe/frappe-bench && bench --site sheikhmahboob.com clear-cache && bench restart'
```

### D) Prove live after change

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/
# expect 200
```

---

## 3) Local Ubuntu setup (dev machine)

This copy is **source only**. To run ERPNext locally you need a full bench + MariaDB + Redis + Node.

### Install prerequisites (Ubuntu 22.04 / 24.04)

```bash
sudo apt update
sudo apt install -y git python3-dev python3-pip python3-venv \
  redis-server mariadb-server \
  nginx curl build-essential \
  libffi-dev libssl-dev wkhtmltopdf
# Node 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g yarn
```

MariaDB: set root auth and create a user (follow current [Frappe Easy Install](https://frappeframework.com/docs/user/en/installation) docs — versions change).

### Create a new bench and use these apps

Option 1 — develop against the custom app only (recommended):

```bash
# install frappe-bench CLI, then:
bench init frappe-bench --frappe-branch version-16
cd frappe-bench
bench new-site sheikhmahboob.local
bench get-app erpnext --branch version-16
bench --site sheikhmahboob.local install-app erpnext

# Point custom app at THIS folder's di:
bench get-app /path/to/sheikhmahboob-erp/apps/di
# or: copy apps/di into frappe-bench/apps/di then
bench --site sheikhmahboob.local install-app di

bench start
# open http://sheikhmahboob.local:8000 (or whatever bench prints)
```

Option 2 — replace apps inside an existing bench with these trees (advanced; match Frappe/ERPNext versions first):

```bash
# Compare versions:
grep -E '__version__|version' apps/frappe/frappe/__init__.py apps/erpnext/erpnext/__init__.py | head
# On server:
#   su - frappe -c 'cd /home/frappe/frappe-bench && bench version'
```

Do **not** copy production `site_config.json` or DB passwords into git/chat.

---

## 4) Pull latest source from VPS again

```bash
./ops/pull-apps.sh
```

---

## 5) What agents should / should not do

**Do**

- Read `AGENTS.md` + this README before changing anything live.
- Prefer editing `apps/di` and `./ops/push-app.sh di`.
- Take a backup before `bench update` or migrations on production.
- Keep nginx changes limited to `sheikhmahboob.conf` / this site.

**Do not**

- Touch `/opt/a7-wa`, OpenWA, `wa.srv1802669.hstgr.cloud`, or any WhatsApp stack.
- Commit or paste production DB passwords / `encryption_key`.
- Run `bench update --reset` without asking Matloob (can break `di`).
- Change the live site folder name without a planned migration.

---

## Quick reference — important server paths

| Path | Role |
|------|------|
| `/home/frappe/frappe-bench` | Bench root |
| `/home/frappe/frappe-bench/apps/di` | Custom app |
| `/home/frappe/frappe-bench/sites/sheikhmahboob.com` | Live site data |
| `/etc/nginx/conf.d/sheikhmahboob.conf` | Domain → ERP |
| `/var/log/nginx/sheikhmahboob.*.log` | Access/error logs |
| `https://sheikhmahboob.com` | Public login |
