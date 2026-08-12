#!/usr/bin/env bash
# Open an interactive SSH session to the Hostinger ERP VPS.
set -euo pipefail

HOST="root@187.127.123.235"
KEY_WIN="C:/Users/Matloob/.ssh/hostinger_codex"
KEY_WSL="/mnt/c/Users/Matloob/.ssh/hostinger_codex"
KEY_MSYS="/c/Users/Matloob/.ssh/hostinger_codex"

KEY=""
if [[ -f "$KEY_WSL" ]]; then
  KEY="$KEY_WSL"
elif [[ -f "$KEY_MSYS" ]]; then
  KEY="$KEY_MSYS"
elif [[ -f "$KEY_WIN" ]]; then
  KEY="$KEY_WIN"
elif [[ -f "${HOME}/.ssh/hostinger_codex" ]]; then
  KEY="${HOME}/.ssh/hostinger_codex"
else
  echo "SSH key not found. Expected: $KEY_WIN" >&2
  exit 1
fi

echo "Connecting $HOST (ERP bench: /home/frappe/frappe-bench-b)…"
echo "After login:  su - frappe && cd frappe-bench-b"
if command -v ssh.exe >/dev/null 2>&1; then
  exec ssh.exe -i "$KEY_WIN" -o IdentitiesOnly=yes -o ServerAliveInterval=30 "$HOST" "$@"
else
  exec ssh -i "$KEY" -o IdentitiesOnly=yes -o ServerAliveInterval=30 "$HOST" "$@"
fi
