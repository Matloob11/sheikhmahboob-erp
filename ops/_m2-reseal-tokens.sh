#!/usr/bin/env bash
# Re-seal pos_token rows that were encrypted with the dev fallback key
# because `sudo -E` is ignored on this host. Does not print tokens or keys.
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

echo "=== RAM before reseal ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/daftar-api.env
set +a
test -n "${TOKEN_ENCRYPTION_KEY:-}"
# Dev fallback that migrate used when the service key was not in the environment.
OLD_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
cd /opt/daftar-api
sudo -u daftar env \
  DATABASE_URL="$DATABASE_URL" \
  TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY" \
  TOKEN_ENCRYPTION_KEY_OLD="$OLD_KEY" \
  NODE_ENV=production \
  node --input-type=module <<'JS'
import { pool } from "./dist/src/db.js";
import { decryptPosToken, encryptPosToken, isEncryptedPosToken } from "./dist/src/crypto/posToken.js";

const current = process.env.TOKEN_ENCRYPTION_KEY;
const oldKey = process.env.TOKEN_ENCRYPTION_KEY_OLD;
const { rows } = await pool.query("SELECT id, pos_token FROM clients WHERE pos_token <> ''");
let resealed = 0;
let already = 0;
for (const row of rows) {
  const stored = String(row.pos_token);
  if (!isEncryptedPosToken(stored)) {
    const sealed = encryptPosToken(stored, current);
    await pool.query("UPDATE clients SET pos_token = $1 WHERE id = $2", [sealed, row.id]);
    resealed += 1;
    continue;
  }
  try {
    decryptPosToken(stored, current);
    already += 1;
    continue;
  } catch {
    const plain = decryptPosToken(stored, oldKey);
    const sealed = encryptPosToken(plain, current);
    await pool.query("UPDATE clients SET pos_token = $1 WHERE id = $2", [sealed, row.id]);
    resealed += 1;
  }
}
console.log(`resealed=${resealed} already_ok=${already}`);
await pool.end();
JS
REMOTE

echo "=== RAM after reseal ==="
ssh_run "free -m" | awk '/^Mem:/{print "RAM_AVAILABLE_MB="$7}'
echo RESEAL_OK
