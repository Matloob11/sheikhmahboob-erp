#!/usr/bin/env bash
# Prove daftar-api Restart=always by killing the process once.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo "=== RAM before kill ==="
free -m | awk '/^Mem:/{print "available_mb="$7}'
OLD_PID=$(systemctl show -p MainPID --value daftar-api.service)
echo "old_pid=$OLD_PID"
kill -9 "$OLD_PID" || true
# Wait for systemd to bring it back
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if systemctl is-active --quiet daftar-api.service; then
    NEW_PID=$(systemctl show -p MainPID --value daftar-api.service)
    if [[ "$NEW_PID" != "0" && "$NEW_PID" != "$OLD_PID" ]]; then
      echo "restarted_pid=$NEW_PID"
      for j in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/v1/health || echo 000)
        if [[ "$code" == "200" ]]; then
          echo "health=$code"
          free -m | awk '/^Mem:/{print "available_mb="$7}'
          echo "RESTART_OK"
          exit 0
        fi
        sleep 1
      done
      echo "health_still=$code"
    fi
  fi
done
echo "RESTART_FAIL"
systemctl status daftar-api.service --no-pager | head -20
exit 1
REMOTE
