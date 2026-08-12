#!/usr/bin/env bash
# Shared paths for ops scripts (sourced, not executed).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="root@187.127.123.235"

# Default = domain instance B (https://sheikhmahboob.com).
# Old client (http://187.127.123.235:8001):
#   BENCH=/home/frappe/frappe-bench SITE=187.127.123.235 ./ops/push-app.sh di
BENCH_A="/home/frappe/frappe-bench"
SITE_A="187.127.123.235"
BENCH_B="/home/frappe/frappe-bench-b"
SITE_B="sheikhmahboob.com"
BENCH="${BENCH:-$BENCH_B}"
SITE="${SITE:-$SITE_B}"

# Public URL used by the "prove it worked" curl. Derived from SITE so that
# deploying to A does not report on B's health, which is what happened while
# this URL was hard-coded in push-app.sh.
URL_A="http://187.127.123.235:8001"
URL_B="https://sheikhmahboob.com"
if [[ "$SITE" == "$SITE_A" ]]; then
  URL="${URL:-$URL_A}"
else
  URL="${URL:-$URL_B}"
fi

resolve_key() {
  local candidates=(
    "/mnt/c/Users/Matloob/.ssh/hostinger_codex"
    "/c/Users/Matloob/.ssh/hostinger_codex"
    "C:/Users/Matloob/.ssh/hostinger_codex"
    "${HOME}/.ssh/hostinger_codex"
  )
  local k
  for k in "${candidates[@]}"; do
    if [[ -f "$k" ]]; then
      echo "$k"
      return 0
    fi
  done
  echo "SSH key hostinger_codex not found" >&2
  return 1
}

KEY="$(resolve_key)"

# Prefer Windows OpenSSH from WSL when available (key path may be /mnt/c/...).
if command -v ssh.exe >/dev/null 2>&1; then
  KEY_WIN="$KEY"
  if command -v wslpath >/dev/null 2>&1; then
    case "$KEY" in
      /mnt/*) KEY_WIN=$(wslpath -w "$KEY") ;;
    esac
  fi
  SSH=(ssh.exe -i "$KEY_WIN" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=25 -o ServerAliveInterval=20 -o StrictHostKeyChecking=accept-new)
else
  SSH=(ssh -i "$KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=25 -o ServerAliveInterval=20 -o StrictHostKeyChecking=accept-new)
fi

ssh_run() {
  "${SSH[@]}" "$HOST" "$@"
}
