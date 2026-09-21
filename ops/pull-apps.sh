#!/usr/bin/env bash
# Replace local apps + bench metadata with a clone from Hostinger.
# Source = live VPS bench (/home/frappe/frappe-bench / sheikhmahboob.com).
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

echo "=== remove local apps (keeping ops/, README, etc.) ==="
rm -rf "$ROOT/apps/frappe" "$ROOT/apps/erpnext" "$ROOT/apps/di"
rm -rf "$ROOT"/apps/di.backup.* 2>/dev/null || true
mkdir -p "$ROOT/apps" "$ROOT/sites" "$ROOT/config"

echo "=== pull from $HOST:$BENCH → $ROOT ==="
ssh_run "cd '$BENCH' && tar -cf - \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  --exclude='*/node_modules' \
  --exclude='*/.ruff_cache' \
  --exclude='*/.git' \
  apps sites/apps.txt sites/apps.json sites/common_site_config.json Procfile config 2>/dev/null" \
  | tar -xf - -C "$ROOT"

echo "=== done (source bench=$BENCH site=$SITE) ==="
du -sh "$ROOT" "$ROOT/apps"/* 2>/dev/null || true
ls -la "$ROOT/apps"
test -f "$ROOT/sites/apps.txt" && echo "--- apps.txt ---" && cat "$ROOT/sites/apps.txt"
