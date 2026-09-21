#!/usr/bin/env bash
# List nightly dumps + rotation evidence.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo "=== RAM ==="
free -m | awk '/^Mem:/{print "available_mb="$7}'
echo "=== cron ==="
cat /etc/cron.d/daftar-pg-dump 2>/dev/null || echo "NO_CRON"
echo "=== dumps (newest first) ==="
ls -1dt /var/backups/daftar-pg/*/ 2>/dev/null | head -10
echo "=== count ==="
find /var/backups/daftar-pg -mindepth 1 -maxdepth 1 -type d | wc -l
echo "=== marker ==="
cat /opt/daftar-api/var/last_dump.json 2>/dev/null || echo "NO_MARKER_YET"
REMOTE
