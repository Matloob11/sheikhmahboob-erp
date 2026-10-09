#!/usr/bin/env bash
# Open an interactive SSH session to the Hostinger ERP VPS.
set -euo pipefail

HOST="root@187.53.143.235"
KEY_WIN="C:/Users/Matloob/.ssh/hostinger_srv1992968"
KEY_WSL="/mnt/c/Users/Matloob/.ssh/hostinger_srv1992968"
KEY_MSYS="/c/Users/Matloob/.ssh/hostinger_srv1992968"
KEY2_WIN="C:/Users/Matloob/.ssh/id_ed25519_hostinger2"
KEY2_WSL="/mnt/c/Users/Matloob/.ssh/id_ed25519_hostinger2"
KEY2_MSYS="/c/Users/Matloob/.ssh/id_ed25519_hostinger2"

KEY=""
KEY_FOR_WIN=""
if [[ -f "$KEY_WSL" ]]; then
  KEY="$KEY_WSL"
  KEY_FOR_WIN="$KEY_WIN"
elif [[ -f "$KEY_MSYS" ]]; then
  KEY="$KEY_MSYS"
  KEY_FOR_WIN="$KEY_WIN"
elif [[ -f "$KEY_WIN" ]]; then
  KEY="$KEY_WIN"
  KEY_FOR_WIN="$KEY_WIN"
elif [[ -f "${HOME}/.ssh/hostinger_srv1992968" ]]; then
  KEY="${HOME}/.ssh/hostinger_srv1992968"
  KEY_FOR_WIN="$KEY_WIN"
elif [[ -f "$KEY2_WSL" ]]; then
  KEY="$KEY2_WSL"
  KEY_FOR_WIN="$KEY2_WIN"
elif [[ -f "$KEY2_MSYS" ]]; then
  KEY="$KEY2_MSYS"
  KEY_FOR_WIN="$KEY2_WIN"
elif [[ -f "$KEY2_WIN" ]]; then
  KEY="$KEY2_WIN"
  KEY_FOR_WIN="$KEY2_WIN"
elif [[ -f "${HOME}/.ssh/id_ed25519_hostinger2" ]]; then
  KEY="${HOME}/.ssh/id_ed25519_hostinger2"
  KEY_FOR_WIN="$KEY2_WIN"
else
  echo "SSH key not found. Expected: $KEY_WIN" >&2
  exit 1
fi

echo "Connecting $HOST (ERP bench: /home/frappe/frappe-bench)…"
echo "After login:  su - frappe && cd frappe-bench"
if command -v ssh.exe >/dev/null 2>&1; then
  exec ssh.exe -i "$KEY_FOR_WIN" -o IdentitiesOnly=yes -o ServerAliveInterval=30 "$HOST" "$@"
else
  exec ssh -i "$KEY" -o IdentitiesOnly=yes -o ServerAliveInterval=30 "$HOST" "$@"
fi
