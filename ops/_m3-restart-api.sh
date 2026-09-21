#!/usr/bin/env bash
# Restart daftar-api after M3 deploy and prove posting routes are live.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
systemctl restart daftar-api.service
sleep 2
echo "active=$(systemctl is-active daftar-api.service)"
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8787/v1/health
ls /opt/daftar-api/dist/src/posting
# status route needs auth — 401 without token is enough to prove it exists
curl -sS -o /dev/null -w "status_no_auth=%{http_code}\n" https://sheikhmahboob.com/pra-api/v1/status
curl -sS -o /dev/null -w "login=%{http_code}\n" https://sheikhmahboob.com/login
curl -sS -o /dev/null -w "pra=%{http_code}\n" https://sheikhmahboob.com/pra/
free -m | awk '/^Mem:/{print "available_mb="$7}'
REMOTE
