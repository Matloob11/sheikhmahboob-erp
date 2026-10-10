#!/usr/bin/env bash
# Upload one local app directory to Hostinger, migrate + restart.
# Usage: ./ops/push-app.sh di
#        ./ops/push-app.sh di --no-migrate
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

APP=""
NO_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --no-migrate) NO_MIGRATE=1 ;;
    -*)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
    *)
      if [[ -z "$APP" ]]; then APP="$arg"; else
        echo "Usage: $0 <app-name> [--no-migrate]" >&2
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$APP" ]]; then
  echo "Usage: $0 <app-name> [--no-migrate]   e.g.  $0 di" >&2
  exit 1
fi
LOCAL="$ROOT/apps/$APP"
if [[ ! -d "$LOCAL" ]]; then
  echo "Missing local app: $LOCAL" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
APP_BACKUP_DIR="/home/frappe/di-backups"
APP_BACKUP_TGZ="${APP_BACKUP_DIR}/${APP}-${STAMP}.tgz"

echo "=== push apps/$APP → $HOST:$BENCH/apps/$APP ==="

echo "=== site backup (with files) ==="
ssh_run "sudo -u frappe bash -lc 'cd $BENCH && bench --site $SITE backup --with-files'"
ssh_run "sudo -u frappe bash -lc 'ls -1t $BENCH/sites/$SITE/private/backups/* | head -n 3'"

echo "=== remote app tarball → $APP_BACKUP_TGZ ==="
ssh_run "mkdir -p '$APP_BACKUP_DIR' && cd '$BENCH/apps' && tar -czf '$APP_BACKUP_TGZ' '$APP' && chown frappe:frappe '$APP_BACKUP_TGZ'"
ssh_run "ls -1t '$APP_BACKUP_DIR'/${APP}-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f"
echo "APP_BACKUP=$APP_BACKUP_TGZ"

tar -cf - \
  --exclude='*/__pycache__' \
  --exclude='*.pyc' \
  --exclude='*/node_modules' \
  --exclude='.git' \
  -C "$ROOT/apps" "$APP" \
  | ssh_run "cd '$BENCH/apps' && tar -xf - && chown -R frappe:frappe '$APP' && chmod -R u=rwX,go=rX '$APP'"

echo "=== build + migrate + restart (site $SITE) ==="
MIGRATE_CMD="bench --site $SITE migrate"
if [[ "$NO_MIGRATE" -eq 1 ]]; then
  MIGRATE_CMD="true"
  echo "(skipping migrate: --no-migrate)"
fi

set +e
ssh_run "sudo -u frappe bash -lc 'cd $BENCH && bench build --app $APP && $MIGRATE_CMD && bench --site $SITE clear-cache'"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  echo "PUSH_FAILED: build/migrate failed." >&2
  echo "Restore with:" >&2
  echo "  tar -xzf $APP_BACKUP_TGZ -C $BENCH/apps && bench --site $SITE migrate && supervisorctl restart frappe-bench-web: frappe-bench-workers:" >&2
  exit "$RC"
fi

# The frappe user has no sudo, so bench restart cannot drive supervisor; restart as root.
echo "=== restart web + workers (root) ==="
ssh_run "supervisorctl restart frappe-bench-web: frappe-bench-workers: && sleep 5 && supervisorctl status"

echo "=== prove ==="
ssh_run "curl -sS -o /dev/null -w 'https=%{http_code}\n' https://sheikhmahboob.com/"
echo "PUSH_OK app=$APP"
