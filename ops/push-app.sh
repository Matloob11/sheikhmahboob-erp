#!/usr/bin/env bash
# Upload one local app directory to Hostinger, migrate + restart.
# Usage: ./ops/push-app.sh di
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

APP="${1:-}"
if [[ -z "$APP" ]]; then
  echo "Usage: $0 <app-name>   e.g.  $0 di" >&2
  exit 1
fi
LOCAL="$ROOT/apps/$APP"
if [[ ! -d "$LOCAL" ]]; then
  echo "Missing local app: $LOCAL" >&2
  exit 1
fi

# Instance A belongs to someone else since the 2026-08-12 split. Deploying to it
# is a deliberate act, not a default.
if [[ "$SITE" == "$SITE_A" ]]; then
  echo "TARGET IS INSTANCE A ($SITE at $URL) — the other party's live site."
  echo "Type YES to continue:"
  read -r ans
  if [[ "$ans" != "YES" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "=== push apps/$APP → $HOST:$BENCH/apps/$APP ==="
# Backup remote app first
ssh_run "cd '$BENCH/apps' && tar -czf /tmp/${APP}-prepush-\$(date +%Y%m%d%H%M%S).tgz '$APP' 2>/dev/null || true"

tar -cf - \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  --exclude='*/node_modules' \
  --exclude='.git' \
  -C "$ROOT/apps" "$APP" \
  | ssh_run "cd '$BENCH/apps' && tar -xf - && chown -R frappe:frappe '$APP'"

echo "=== build + migrate + restart (site $SITE) ==="
ssh_run "sudo -u frappe bash -lc 'cd $BENCH && bench build --app $APP && bench --site $SITE migrate && bench --site $SITE clear-cache && bench restart'"

echo "=== prove ($URL) ==="
ssh_run "curl -sS -o /dev/null -w 'http=%{http_code}\n' '$URL'"
echo "PUSH_OK app=$APP site=$SITE"
