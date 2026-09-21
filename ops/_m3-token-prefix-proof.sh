#!/usr/bin/env bash
# Print only first 7 chars of non-empty pos_token + counts. Never full tokens.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"
echo "=== RAM ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
docker exec daftar-pg psql -U daftar -d daftar -c \
  "SELECT left(pos_token, 7) AS prefix, count(*) AS rows
   FROM clients
   WHERE pos_token <> ''
   GROUP BY 1
   ORDER BY 1;"
REMOTE
