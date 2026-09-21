#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

echo "=== RAM before restart ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo "RAM_BEFORE"; free -m
systemctl restart daftar-api
sleep 3
systemctl is-active daftar-api
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8787/v1/health
# Prove token column is encrypted (no plaintext leak in a sample dump line)
docker exec daftar-pg psql -U daftar -d daftar -Atc "SELECT CASE WHEN pos_token LIKE 'enc:v1:%' THEN 'encrypted' WHEN pos_token='' THEN 'empty' ELSE 'PLAINTEXT_LEAK' END FROM clients WHERE pos_token <> '' LIMIT 5;"
echo "RAM_AFTER"; free -m
REMOTE

echo "=== public proofs ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
curl -sS -o /dev/null -w "login=%{http_code}\n" https://sheikhmahboob.com/login
curl -sS -o /dev/null -w "pra=%{http_code}\n" https://sheikhmahboob.com/pra/
curl -sS -o /dev/null -w "pra_api_health=%{http_code}\n" https://sheikhmahboob.com/pra-api/v1/health
REMOTE

echo "=== RAM after ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'
echo RESTART_OK
