#!/usr/bin/env bash
# Run a careful bench update on Hostinger. Asks for confirmation.
# Usage: ./ops/remote-update.sh
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

echo "WARNING: This pulls upstream frappe/erpnext on PRODUCTION."
echo "Host: $HOST  Bench: $BENCH  Site: $SITE"
echo "Custom app 'di' may break if versions jump. Type YES to continue:"
read -r ans
if [[ "$ans" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi

echo "=== backup apps+sites (tarball on server) ==="
ssh_run "cd /home/frappe && tar -czf /root/frappe-bench-preupdate-\$(date +%Y%m%d%H%M%S).tgz frappe-bench/apps frappe-bench/sites/apps.txt frappe-bench/sites/apps.json frappe-bench/sites/sheikhmahboob.com/site_config.json && ls -lh /root/frappe-bench-preupdate-*.tgz | tail -3"

echo "=== bench update ==="
ssh_run "sudo -u frappe bash -lc 'cd $BENCH && bench update --reset'"

echo "=== migrate + restart ==="
ssh_run "sudo -u frappe bash -lc 'cd $BENCH && bench --site $SITE migrate && bench --site $SITE clear-cache && bench restart'"

echo "=== prove ==="
ssh_run "curl -sS -o /dev/null -w 'https=%{http_code}\n' https://sheikhmahboob.com/"
echo "REMOTE_UPDATE_OK"
