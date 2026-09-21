#!/usr/bin/env bash
# Pull daftar Postgres dump from VPS → server-snapshot/daftar-pg/<stamp>/
# Stage on host → tar over SSH → verify sha256 → delete remote staging.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOCAL_DEST="$ROOT/server-snapshot/daftar-pg/$STAMP"

echo "=== 1/4 dump + stage on $HOST ==="
STAGE_LOG="$(mktemp)"
ssh_run 'bash -s' <<REMOTE | tee "$STAGE_LOG"
set -euo pipefail
STAMP='$STAMP'
STAGE="/root/daftar-pg-pull-\$STAMP"
mkdir -p "\$STAGE"
docker exec daftar-pg pg_dump -U daftar -d daftar -Fc -f /tmp/daftar.dump
docker cp daftar-pg:/tmp/daftar.dump "\$STAGE/daftar.dump"
docker exec daftar-pg rm -f /tmp/daftar.dump
sha256sum "\$STAGE/daftar.dump" | tee "\$STAGE/daftar.dump.sha256"
echo "SNAPSHOT_DIR=\$STAGE"
echo "SNAPSHOT_OK"
REMOTE

REMOTE_DIR="$(grep -m1 '^SNAPSHOT_DIR=' "$STAGE_LOG" | cut -d= -f2-)"
grep -q '^SNAPSHOT_OK$' "$STAGE_LOG" || { echo "staging failed" >&2; exit 1; }
rm -f "$STAGE_LOG"
[[ -n "$REMOTE_DIR" ]] || exit 1

echo "=== 2/4 pull → $LOCAL_DEST ==="
mkdir -p "$LOCAL_DEST"
ssh_run "tar -cf - -C '$REMOTE_DIR' ." | tar -xf - -C "$LOCAL_DEST"

echo "=== 3/4 verify sha256 ==="
(
  cd "$LOCAL_DEST"
  # Remote sha256 line has an absolute path; rewrite to local basename.
  if [[ -f daftar.dump.sha256 ]]; then
    awk '{print $1 "  daftar.dump"}' daftar.dump.sha256 > daftar.dump.sha256.local
    mv daftar.dump.sha256.local daftar.dump.sha256
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c daftar.dump.sha256
  else
    echo "skip sha256sum check (tool missing); file present: $(ls -la daftar.dump)"
  fi
)

echo "=== 4/4 remove staging on server ==="
ssh_run "rm -rf '$REMOTE_DIR' && echo removed"

echo "PULL_OK $LOCAL_DEST"
# Desk health banner reads this via a manual "mark pulled" button; also stamp a local marker.
MARKER="$ROOT/server-snapshot/daftar-pg/.last-pull"
mkdir -p "$(dirname "$MARKER")"
date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
echo "LAST_PULL_MARKER $MARKER"
