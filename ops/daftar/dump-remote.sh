#!/usr/bin/env bash
# Nightly: dump daftar Postgres on the VPS into /var/backups/daftar-pg/<stamp>/
# Rotates local copies older than 14 days. Does NOT pull to laptop (see pull-daftar-pg.sh).
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/var/backups/daftar-pg/$STAMP"
CONTAINER="${DAFTAR_PG_CONTAINER:-daftar-pg}"
mkdir -p "$OUT"
docker exec "$CONTAINER" pg_dump -U daftar -d daftar -Fc -f /tmp/daftar.dump
docker cp "$CONTAINER:/tmp/daftar.dump" "$OUT/daftar.dump"
docker exec "$CONTAINER" rm -f /tmp/daftar.dump
sha256sum "$OUT/daftar.dump" | tee "$OUT/daftar.dump.sha256"
# Keep 14 days on disk
find /var/backups/daftar-pg -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "DUMP_OK $OUT"
