#!/usr/bin/env bash
# Quick inventory for daftar deploy (no changes).
set -euo pipefail
echo "RAM"
free -m
echo "DOCKER"
command -v docker || echo missing
docker --version 2>/dev/null || true
echo "NODE"
command -v node || echo missing
node -v 2>/dev/null || true
echo "USER"
id daftar 2>/dev/null || echo no_daftar_user
echo "PORTS"
ss -ltn | grep -E ':5432|:5433|:8787' || echo none
echo "DONE"
