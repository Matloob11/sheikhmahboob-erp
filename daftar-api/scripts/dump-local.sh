#!/usr/bin/env bash
# Local pg_dump of daftar DB → ../server-snapshot/daftar-pg/<stamp>/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# Prefer Windows docker.exe when this script is run under WSL without Docker integration.
DOCKER_BIN="docker"
if ! command -v docker >/dev/null 2>&1; then
  if command -v docker.exe >/dev/null 2>&1; then
    DOCKER_BIN="docker.exe"
  else
    echo "docker not found (start Docker Desktop, or enable WSL integration)" >&2
    exit 1
  fi
fi

# Resolve repo root on Windows even when invoked via WSL bash.
if [[ "$ROOT" == /mnt/* ]]; then
  OUT_DIR="$ROOT/../server-snapshot/daftar-pg/$STAMP"
else
  OUT_DIR="$(cd "$ROOT/.." && pwd)/server-snapshot/daftar-pg/$STAMP"
fi
mkdir -p "$OUT_DIR"

CONTAINER="${DAFTAR_PG_CONTAINER:-daftar-pg}"
DUMP_FILE="$OUT_DIR/daftar.dump"

echo "Dumping $CONTAINER → $DUMP_FILE"
$DOCKER_BIN exec "$CONTAINER" pg_dump -U daftar -d daftar -Fc -f /tmp/daftar.dump
$DOCKER_BIN cp "$CONTAINER:/tmp/daftar.dump" "$DUMP_FILE"
$DOCKER_BIN exec "$CONTAINER" rm -f /tmp/daftar.dump

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DUMP_FILE" | tee "$OUT_DIR/daftar.dump.sha256"
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 "$DUMP_FILE" | tee "$OUT_DIR/daftar.dump.sha256"
else
  echo "WARN: no sha256 tool; dump written without checksum"
fi

echo "DUMP_OK $OUT_DIR"
