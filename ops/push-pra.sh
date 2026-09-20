#!/usr/bin/env bash
# Build Daftar (pra/) with public path /pra/ and upload static files to Hostinger.
# Reloads nginx only. Does NOT run bench migrate/restart or ops/push-app.sh.
# Usage: ./ops/push-pra.sh
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

# Git Bash otherwise converts /pra/ into /Program Files/Git/pra/.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"
export PRA_LIVE_BASE=1

LOCAL="$ROOT/pra"
REMOTE_DIR="/var/www/pra-site/pra"

if [[ ! -d "$LOCAL" ]]; then
  echo "Missing local desk: $LOCAL" >&2
  exit 1
fi
if [[ ! -f "$LOCAL/package.json" ]]; then
  echo "Missing $LOCAL/package.json" >&2
  exit 1
fi

# Relative outDir. Git Bash absolute paths (/c/Users/...) are not where Node writes on Windows.
OUT="$LOCAL/.live-dist"
rm -rf "$OUT"

echo "=== lint pra (non-fatal) ==="
(cd "$LOCAL" && npm run lint) || echo "oxlint reported issues (push continues)"

echo "=== build pra (PRA_LIVE_BASE=1 → /pra/) ==="
(
  cd "$LOCAL"
  # Inline env so nested shells / Windows npm wrappers cannot drop the export.
  env PRA_LIVE_BASE=1 npx --no-install vite build --outDir .live-dist --emptyOutDir
)

if [[ ! -f "$OUT/index.html" ]]; then
  echo "Build did not produce index.html" >&2
  exit 1
fi
if ! grep -q 'src="/pra/assets/' "$OUT/index.html"; then
  echo "Build is missing /pra/ asset URLs" >&2
  cat "$OUT/index.html" >&2
  exit 1
fi
if grep -q 'Program Files' "$OUT/index.html"; then
  echo "Refuse Git Bash path rewrite in index.html" >&2
  exit 1
fi

echo "=== upload dist → $HOST:$REMOTE_DIR ==="
tar -cf - -C "$OUT" . | ssh_run "rm -rf /tmp/pra-upload && mkdir -p /tmp/pra-upload && tar -xf - -C /tmp/pra-upload && grep -q 'src=\"/pra/assets/' /tmp/pra-upload/index.html && ! grep -q 'Program Files' /tmp/pra-upload/index.html && mkdir -p /var/www/pra-site && rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR' && cp -a /tmp/pra-upload/. '$REMOTE_DIR/' && chown -R www-data:www-data /var/www/pra-site && rm -rf /tmp/pra-upload"

echo "=== nginx -t ==="
ssh_run "nginx -t"

echo "=== reload nginx ==="
ssh_run "systemctl reload nginx"

echo "=== prove ==="
ssh_run "curl -sS -o /dev/null -w '/pra/ %{http_code}\\n' https://sheikhmahboob.com/pra/"
# Informational. A 502 here is the known VPS TLS leftover — do not fail the push.
ssh_run "curl -sS -o /dev/null -w '/pra-ims %{http_code}\\n' https://sheikhmahboob.com/pra-ims/ims/sandbox/api/Live/PostData || true"
echo "PUSH_OK pra"
