# Daftar API (Milestone 1)

Local-first backend for the PRA desk. **No live VPS until Matloob says READY.**

## Isolation (hard rules)

- Postgres listens on **127.0.0.1 only** (compose maps `127.0.0.1:5433→5432`).
- Named volume `daftar_pg_data` only — never MariaDB, never `/home/frappe`, never the Frappe bench.
- API binds `127.0.0.1:8787`.
- When READY later: one nginx `location ^~ /pra-api/` (Origin + rate limit + body cap); separate systemd unit; nothing else in `sheikhmahboob.conf` changes.

## Quick start

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run migrate
npm run dev
```

Bootstrap owner (once):

```bash
curl -sS -X POST http://127.0.0.1:8787/v1/auth/bootstrap-owner \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"owner@example.com\",\"password\":\"change-me-now\"}"
```

Login + import a desk backup JSON:

```bash
curl -sS -c /tmp/daftar.ck -X POST http://127.0.0.1:8787/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"owner@example.com\",\"password\":\"change-me-now\"}"

curl -sS -b /tmp/daftar.ck -X POST http://127.0.0.1:8787/v1/import/desk-backup \
  -H "Content-Type: application/json" --data-binary @daftar-backup.json

curl -sS -b /tmp/daftar.ck http://127.0.0.1:8787/v1/import/summary
```

Hand password reset (no email):

```bash
npm run create-owner -- --email owner@example.com --password new-secret
```

Local dump (disk + leave a copy you can copy off the machine):

```bash
# Git Bash / WSL (needs docker on PATH)
./scripts/dump-local.sh

# Windows PowerShell
powershell -File ./scripts/dump-local.ps1
```

Writes `../server-snapshot/daftar-pg/<stamp>/daftar.dump` + sha256.

## Tests

```bash
npm test
npm run typecheck
```

## Out of M1

Live nginx/systemd, PRA posting, token encryption at rest, Dexie sync (M2/M3).
