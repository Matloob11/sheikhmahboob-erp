#!/usr/bin/env bash
# Prove desk stays usable when daftar-api is down; queue drains on restart.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

CREDS_FILE="$(mktemp)"
ssh_run 'bash -s' <<'REMOTE' >"$CREDS_FILE"
awk -F= '/^email=/{print "EMAIL="$2} /^password=/{print "PASS="$2}' /root/daftar-owner.credentials
REMOTE
EMAIL="$(awk -F= '/^EMAIL=/{print substr($0,7)}' "$CREDS_FILE" | tr -d '\r')"
PASS="$(awk -F= '/^PASS=/{print substr($0,6)}' "$CREDS_FILE" | tr -d '\r')"
rm -f "$CREDS_FILE"
if [[ -z "$EMAIL" || -z "$PASS" ]]; then
  echo "missing owner credentials" >&2
  exit 1
fi

NODE_BIN="$(command -v node.exe 2>/dev/null || command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" && -x "/c/Program Files/nodejs/node.exe" ]]; then
  NODE_BIN="/c/Program Files/nodejs/node.exe"
fi

echo "=== RAM before stop ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo "RAM_BEFORE_STOP"; free -m
systemctl stop daftar-api
sleep 1
systemctl is-active daftar-api || true
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8787/v1/health || true)
echo "api_while_stopped=${code:-000}"
curl -sS -o /dev/null -w "pra=%{http_code}\n" https://sheikhmahboob.com/pra/
curl -sS -o /dev/null -w "login=%{http_code}\n" https://sheikhmahboob.com/login
echo "RAM_AFTER_STOP"; free -m
REMOTE

cd "$ROOT/pra"
"$NODE_BIN" scripts/m2-offline-desk.mjs --phase=down

echo "=== RAM before start ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
systemctl start daftar-api
sleep 3
systemctl is-active daftar-api
curl -sS -o /dev/null -w "health=%{http_code}\n" http://127.0.0.1:8787/v1/health
curl -sS -o /dev/null -w "pra=%{http_code}\n" https://sheikhmahboob.com/pra/
curl -sS -o /dev/null -w "login=%{http_code}\n" https://sheikhmahboob.com/login
echo "RAM_AFTER_START"; free -m
REMOTE

mkdir -p "$ROOT/pra/artifacts/m2-offline"
CRED_FILE="$ROOT/pra/artifacts/m2-offline/.session"
umask 077
printf '%s\n%s\n' "$EMAIL" "$PASS" >"$CRED_FILE"
CRED_WIN="C:/Users/Matloob/Desktop/sheikhmahboob-erp/pra/artifacts/m2-offline/.session"
"$NODE_BIN" scripts/m2-offline-desk.mjs --phase=drain "--cred-file=$CRED_WIN"
rm -f "$CRED_FILE"

echo "=== RAM final ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'
echo OFFLINE_PROVE_OK
