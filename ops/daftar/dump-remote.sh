#!/usr/bin/env bash
# Nightly: dump daftar Postgres on the VPS into /var/backups/daftar-pg/<stamp>/
# Rotates local copies older than 14 days. Does NOT pull to laptop (see pull-daftar-pg.sh).
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="/var/backups/daftar-pg/$STAMP"
CONTAINER="${DAFTAR_PG_CONTAINER:-daftar-pg}"
MARKER_DIR="/opt/daftar-api/var"
mkdir -p "$OUT" "$MARKER_DIR"
docker exec "$CONTAINER" pg_dump -U daftar -d daftar -Fc -f /tmp/daftar.dump
docker cp "$CONTAINER:/tmp/daftar.dump" "$OUT/daftar.dump"
docker exec "$CONTAINER" rm -f /tmp/daftar.dump
sha256sum "$OUT/daftar.dump" | tee "$OUT/daftar.dump.sha256"
# Marker the API can read (no secrets — path + time only)
umask 022
cat > "$MARKER_DIR/last_dump.json" <<EOF
{"at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","stamp":"$STAMP","path":"$OUT"}
EOF
chown daftar:daftar "$MARKER_DIR/last_dump.json" 2>/dev/null || true
# Keep 14 days on disk
find /var/backups/daftar-pg -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "DUMP_OK $OUT"
