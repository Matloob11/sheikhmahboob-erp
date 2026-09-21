#!/usr/bin/env bash
# Run M2 two-browser Playwright proof without printing credentials.
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
  echo "missing owner credentials on server" >&2
  exit 1
fi

cd "$ROOT/pra"
NODE_BIN="$(command -v node.exe 2>/dev/null || command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" && -x "/c/Program Files/nodejs/node.exe" ]]; then
  NODE_BIN="/c/Program Files/nodejs/node.exe"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found" >&2
  exit 1
fi

if [[ ! -d node_modules/playwright ]]; then
  npm install --no-save playwright@1.55.0
  npx playwright install chromium
fi

echo "=== RAM before playwright ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'

mkdir -p "$ROOT/pra/artifacts/m2-sync"
CRED_FILE="$ROOT/pra/artifacts/m2-sync/.session"
umask 077
printf '%s\n%s\n' "$EMAIL" "$PASS" >"$CRED_FILE"
# node.exe needs a Windows path. Git Bash /c or /mnt/c both map to C:.
CRED_WIN="C:/Users/Matloob/Desktop/sheikhmahboob-erp/pra/artifacts/m2-sync/.session"
BROWSER_CACHE="/c/Users/Matloob/AppData/Local/Temp/cursor-sandbox-cache/1e7c6e494fbfc2ca3b46278cf9463b9e/playwright"
if [[ -d "$BROWSER_CACHE/chromium_headless_shell-1187" ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="$BROWSER_CACHE"
else
  (cd "$ROOT/pra" && npx playwright install chromium)
fi
"$NODE_BIN" scripts/m2-two-browser-sync.mjs "--cred-file=$CRED_WIN" || {
  rm -f "$CRED_FILE"
  exit 1
}
rm -f "$CRED_FILE"

echo "=== prove login+pra ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
curl -sS -o /dev/null -w "login=%{http_code}\n" https://sheikhmahboob.com/login
curl -sS -o /dev/null -w "pra=%{http_code}\n" https://sheikhmahboob.com/pra/
free -m | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'
REMOTE

echo PLAYWRIGHT_OK
