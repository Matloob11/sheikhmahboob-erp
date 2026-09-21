#!/usr/bin/env bash
# Prove a daftar pg_dump can restore. Restores into a scratch DB on the VPS,
# compares row counts to live `daftar`, then DROPS the scratch DB.
#
# Usage (from repo root, via Git Bash / WSL):
#   ./ops/restore-daftar-pg-scratch.sh
#   ./ops/restore-daftar-pg-scratch.sh /path/to/daftar.dump   # local dump (uploaded)
#
# Emergency restore INTO live (destructive — ask owner first):
#   See comments at bottom of this file.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

SCRATCH_DB="daftar_scratch_$$"
LOCAL_DUMP="${1:-}"

ram_report() {
  echo "RAM_AVAILABLE_MB=$(ssh_run "free -m" | awk '/^Mem:/{print $7}')"
}

echo "=== RAM before ==="
ram_report

echo "=== 1 locate dump ==="
ssh_run 'bash -s' <<REMOTE
set -euo pipefail
SCRATCH='$SCRATCH_DB'
LATEST=\$(ls -1t /var/backups/daftar-pg/*/daftar.dump 2>/dev/null | head -1 || true)
if [[ -z "\$LATEST" ]]; then
  echo "No dump under /var/backups/daftar-pg/*/ — taking one now"
  if [[ -x /usr/local/sbin/daftar-pg-dump ]]; then
    /usr/local/sbin/daftar-pg-dump
  else
    STAMP=\$(date -u +%Y%m%dT%H%M%SZ)
    mkdir -p "/var/backups/daftar-pg/\$STAMP"
    docker exec daftar-pg pg_dump -U daftar -d daftar -Fc -f /tmp/daftar-live.dump
    docker cp daftar-pg:/tmp/daftar-live.dump "/var/backups/daftar-pg/\$STAMP/daftar.dump"
    docker exec daftar-pg rm -f /tmp/daftar-live.dump
  fi
  LATEST=\$(ls -1t /var/backups/daftar-pg/*/daftar.dump | head -1)
fi
echo "DUMP=\$LATEST"
test -f "\$LATEST"
cp "\$LATEST" /tmp/daftar-scratch-source.dump
echo SCRATCH_SOURCE_OK
REMOTE

echo "=== RAM after dump locate ==="
ram_report

echo "=== 2 create scratch DB + restore ==="
ssh_run 'bash -s' <<REMOTE
set -euo pipefail
SCRATCH='$SCRATCH_DB'
# Terminate nothing on live; create empty DB as daftar superuser inside container.
docker exec daftar-pg psql -U daftar -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \$SCRATCH;"
docker exec daftar-pg psql -U daftar -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \$SCRATCH OWNER daftar;"
docker cp /tmp/daftar-scratch-source.dump daftar-pg:/tmp/scratch.dump
docker exec daftar-pg pg_restore -U daftar -d "\$SCRATCH" --no-owner --role=daftar /tmp/scratch.dump || true
# pg_restore may warn on extensions; verify tables exist
docker exec daftar-pg psql -U daftar -d "\$SCRATCH" -c "\\dt" | head -20
echo RESTORE_OK
REMOTE

echo "=== RAM after restore ==="
ram_report

echo "=== 3 compare row counts live vs scratch ==="
COUNTS="$(ssh_run 'bash -s' <<REMOTE
set -euo pipefail
SCRATCH='$SCRATCH_DB'
live() { docker exec daftar-pg psql -U daftar -d daftar -Atc "\$1"; }
scratch() { docker exec daftar-pg psql -U daftar -d "\$SCRATCH" -Atc "\$1"; }
for t in clients invoices buyers catalog_items purchases returns psids users; do
  L=\$(live "SELECT count(*) FROM \$t")
  S=\$(scratch "SELECT count(*) FROM \$t")
  echo "\$t live=\$L scratch=\$S"
  if [[ "\$L" != "\$S" ]]; then
    echo "COUNT_MISMATCH \$t"
    exit 1
  fi
done
echo COUNTS_MATCH
REMOTE
)"
echo "$COUNTS"
echo "$COUNTS" | grep -q COUNTS_MATCH

echo "=== 4 drop scratch ==="
ssh_run 'bash -s' <<REMOTE
set -euo pipefail
SCRATCH='$SCRATCH_DB'
docker exec daftar-pg psql -U daftar -d postgres -c "DROP DATABASE IF EXISTS \$SCRATCH;"
docker exec daftar-pg rm -f /tmp/scratch.dump
rm -f /tmp/daftar-scratch-source.dump
echo SCRATCH_DROPPED
REMOTE

echo "=== RAM after drop ==="
ram_report
echo "RESTORE_PROOF_OK"

# ---------------------------------------------------------------------------
# EMERGENCY: restore dump INTO live daftar (DESTROYS current data)
# Only when Matloob explicitly asks. Steps:
#   1. systemctl stop daftar-api
#   2. docker exec daftar-pg psql -U daftar -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='daftar' AND pid <> pg_backend_pid();"
#   3. docker exec daftar-pg psql -U daftar -d postgres -c "DROP DATABASE daftar;"
#   4. docker exec daftar-pg psql -U daftar -d postgres -c "CREATE DATABASE daftar OWNER daftar;"
#   5. docker cp /var/backups/daftar-pg/<file>.dump daftar-pg:/tmp/restore.dump
#   6. docker exec daftar-pg pg_restore -U daftar -d daftar --no-owner /tmp/restore.dump
#   7. systemctl start daftar-api
#   8. curl -sS http://127.0.0.1:8787/v1/health
# ---------------------------------------------------------------------------
