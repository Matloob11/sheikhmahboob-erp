# Agent notes — Sheikh Mahboob ERP

This directory is **only** the Frappe/ERPNext ERP for `sheikhmahboob.com`.

It has **no dependency** on the A7 WhatsApp / OpenWA / Bitrix inbox repos. Do not open or modify those projects while working here unless Matloob explicitly asks.

## PRA / Daftar (separate product)

Live desk is [`pra/`](pra/). Read [`pra/README.md`](pra/README.md) and [`pra/AGENTS.md`](pra/AGENTS.md) first.

- Edit `pra/` only. There is no `pra-invoicing/` folder in this repo.
- Do **not** deploy Daftar with `./ops/push-app.sh di` or install it on the Frappe bench.
- Deploy static `/pra` only when Matloob asks: `./ops/push-pra.sh`.
- Five-batch prompts: [`pra/ops/agents/`](pra/ops/agents/).

## Before any live change

1. Read [README.md](README.md) end to end.
2. Confirm target: Hostinger `root@187.53.143.235`, bench `/home/frappe/frappe-bench`, site `sheikhmahboob.com`.
3. Prefer `./ssh.sh` then work as `frappe` user.
4. Prefer deploying custom code with `./ops/push-app.sh di`.

## SSH

- Key (first): `C:\Users\Hp\.ssh\hostinger_187_53_143_235` (WSL: `/mnt/c/Users/Hp/.ssh/hostinger_187_53_143_235`, MSYS: `/c/Users/Hp/.ssh/hostinger_187_53_143_235`)
- Fallback: `C:\Users\Matloob\.ssh\hostinger_srv1992968`
- Helper: `./ssh.sh`
- Site-less tests: `wsl -d Ubuntu -- bash ops/run-tests-wsl.sh`

## Safe default workflow

1. Edit `apps/di` locally (or pull first: `./ops/pull-apps.sh`).
2. `./ops/push-app.sh di`
3. Prove: `curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/` → `200`

## Dangerous commands (ask first)

- `bench update --reset`
- Dropping / renaming the production site
- Editing nginx configs other than `sheikhmahboob.conf`
- Changing DNS for `sheikhmahboob.com`

## Secrets

Never print or commit `sites/*/site_config.json` from the server (DB password, encryption_key). This local tree intentionally omits that file.
