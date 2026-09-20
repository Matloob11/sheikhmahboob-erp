#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/daftar-api.env
set +a
cd /opt/daftar-api
sudo -u daftar env DATABASE_URL="$DATABASE_URL" node dist/src/migrate.js
curl -sS http://127.0.0.1:8787/v1/health
echo
free -m | head -2
systemctl is-active daftar-api
