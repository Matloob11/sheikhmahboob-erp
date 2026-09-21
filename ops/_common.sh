#!/usr/bin/env bash
# Shared paths for ops scripts (sourced, not executed).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="root@187.53.143.235"

# Live box after 2026-09-19 cutover (srv1992968). Historical split docs stay in ops/*.md.
BENCH="/home/frappe/frappe-bench"
SITE="sheikhmahboob.com"

resolve_key() {
  local candidates=(
    "/mnt/c/Users/Matloob/.ssh/hostinger_srv1992968"
    "/c/Users/Matloob/.ssh/hostinger_srv1992968"
    "C:/Users/Matloob/.ssh/hostinger_srv1992968"
    "${HOME}/.ssh/hostinger_srv1992968"
  )
  local k
  for k in "${candidates[@]}"; do
    if [[ -f "$k" ]]; then
      echo "$k"
      return 0
    fi
  done
  echo "SSH key hostinger_srv1992968 not found" >&2
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
