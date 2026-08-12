# Agent notes — Sheikh Mahboob ERP

This directory is **only** the Frappe/ERPNext ERP on the Hostinger VPS.

It has **no dependency** on the A7 WhatsApp / OpenWA / Bitrix inbox repos. Do not open or modify those projects while working here unless Matloob explicitly asks.

## There are two instances — know which one you are touching

Since the 2026-08-12 split the same VPS runs two independent ERPs.

| | Instance A | Instance B |
|---|---|---|
| Whose | **another party's** production data | ours |
| URL | `http://187.127.123.235:8001` | `https://sheikhmahboob.com` |
| Bench | `/home/frappe/frappe-bench` | `/home/frappe/frappe-bench-b` |
| Site | `187.127.123.235` | `sheikhmahboob.com` |
| Database | `_dd4d7ef3e3991574` | `erp_b` |

**Default to instance B for everything.** Instance A is not ours to change: it holds someone else's invoices and their FBR credentials. Touch it only when Matloob asks for it by name, and say so plainly before you do.

`ops/_common.sh` defaults every script to B. `ops/push-app.sh` demands a typed `YES` before it will deploy to A.

## Before any live change

1. Read [README.md](README.md) end to end.
2. Say out loud which instance you are targeting, and check it against the table above.
3. Prefer `./ssh.sh` then work as the `frappe` user.
4. Prefer deploying custom code with `./ops/push-app.sh di` (goes to B).

## SSH

- Key: `C:\Users\Matloob\.ssh\hostinger_codex` (WSL: `/mnt/c/Users/Matloob/.ssh/hostinger_codex`)
- Helper: `./ssh.sh`

## Safe default workflow

1. Edit `apps/di` locally (or pull first: `./ops/pull-apps.sh`).
2. `./ops/push-app.sh di`
3. Prove: `curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/` → `200`

## Dangerous — ask first

- Anything at all against instance A
- `bench update --reset`
- Dropping / renaming either site
- Bulk deletes of master data (HS Code, Item, Customer)
- Editing nginx configs other than `sheikhmahboob-erp.conf` and `sheikhmahboob-erp-ip.conf`
- Changing DNS for `sheikhmahboob.com`
- Entering FBR credentials, or enabling `auto_post_on_submit` in Production mode — FBR submissions are filed against a real tax identity and cannot be reversed

## Not on this box's ERP, do not touch

`/opt/a7-wa`, OpenWA, n8n, `pearlzshop.conf`, `a7-*.conf`. They share the server.

## Secrets

Never print or commit `sites/*/site_config.json` from the server (DB password, `encryption_key`). This local tree intentionally omits that file.

Instance A's `encryption_key` was deliberately **not** copied into instance B, so B cannot decrypt any Password field that came across in the restore. That is on purpose: those tokens are the other party's FBR credentials. B needs its own.

## Branding

Logos are generated, not hand-edited. Change `branding/build_logo.py` and re-run it; do not edit `branding/*.svg` directly. `librsvg` — which rasterises the PNG used by the print/PDF letter head — silently drops `<textPath>`, which is why the circular lettering is emitted as one rotated `<text>` per character.
