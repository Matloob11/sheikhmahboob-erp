# Server checklist — 2026-10 (do not run from the agent)

Matloob runs these on `root@187.53.143.235`. Keep a second SSH session open for any SSH hardening step.

## 1. Deploy and prove first (before reboot)

```bash
# From the laptop (Git Bash / WSL), on branch di-fixes after review:
./ops/push-app.sh di
```

On the VPS:

```bash
supervisorctl status
# every frappe-bench-* process must be RUNNING

# Production DI Preview on an existing submitted invoice (unchanged payload):
# Desk → Sale Tax Invoice → open e.g. STI-0309 → Preview / DI Preview

cd /home/frappe/frappe-bench/sites
../env/bin/python ../apps/di/di/tests/run.py
# expect: Ran N tests ... OK (skipped=4)
```

Keep `/home/frappe/di-backups/<app>-<timestamp>.tgz` and the site DB backup from the same minute until the next successful deploy.

If migrate failed, restore with the path printed by `push-app.sh`:

```bash
tar -xzf /home/frappe/di-backups/di-<timestamp>.tgz -C /home/frappe/frappe-bench/apps
cd /home/frappe/frappe-bench && bench --site sheikhmahboob.com migrate && bench restart
```

## 2. After deploy — patches and one-time syncs

`bench migrate` (inside push-app) runs patches including `di.patches.purge_token_versions`.

Then once each from DI Settings (System Manager):

1. **Sync UOMs**
2. **Sync SRO Item Codes**

Check Error Log for new `di.*` entries.

## 3. Token history purge (also in patch)

If the patch has not run yet:

```bash
bench --site sheikhmahboob.com mariadb
```

```sql
DELETE FROM tabVersion
WHERE ref_doctype IN ('Seller Or Company','DI Settings')
  AND (
    data LIKE '%sandbox_token%'
    OR data LIKE '%production_token%'
    OR data LIKE '%access_token%'
    OR data LIKE '%pos_bearer_token%'
  );
```

Note: existing DB backups still contain those Version rows.

## 4. SSH hardening

```bash
# Lexically first file wins over 50-cloud-init.conf
cat >/etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh
```

Verify a **second** key login before closing the first session.

```bash
apt-get install -y fail2ban
systemctl enable --now fail2ban
# ensure sshd jail is active
fail2ban-client status sshd
```

## 5. Pending reboot and apt

Kernel pending (e.g. 7.0.0-34) and ~21 apt upgrades — in a maintenance window:

```bash
apt-get update && apt-get upgrade -y
reboot
```

After reboot:

```bash
supervisorctl status
curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/login
# expect 200
```

## 6. App permissions on disk

```bash
chmod -R u=rwX,go=rX /home/frappe/frappe-bench/apps/di
```

(`push-app.sh` now does this on each upload.)

## 7. Backups

Today: cron `bench --site all backup` every 6 h, DB only, 3 copies, same disk, unencrypted, no off-box copy.

Improve:

- Add `--with-files`
- Raise `backup_limit` in site config
- Copy off-box (`rclone` / `scp`)
- One restore drill
- Delete `/root/live_for_staging.sql` once confirmed unneeded

## 8. System Settings and 2FA

- `session_expiry`: `170:00` → `24:00`
- `allow_error_traceback`: `0`
- Enable Two Factor with method **OTP App**
- Tick Two Factor only on Role **System Manager** (not All, not DI Panel User)
- Keep a second admin session open while enrolling
- Confirm a Client Panel user still logs in **without** an OTP prompt
