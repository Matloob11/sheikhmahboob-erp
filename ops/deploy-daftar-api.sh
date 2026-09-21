#!/usr/bin/env bash
# Deploy Daftar API M1 to the live VPS. Does NOT touch Frappe/MariaDB/bench.
#   ./ops/deploy-daftar-api.sh
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")" && pwd)/_common.sh"

HERE="$(cd "$(dirname "$0")" && pwd)"
API_SRC="$ROOT/daftar-api"
NGINX_SRC="$HERE/nginx/srv1992968-sheikhmahboob.conf"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

scp_to() {
  local src=$1 dst=$2
  local key_win="$KEY"
  local src_win="$src"
  case "$KEY" in
    /mnt/c/*) key_win=$(wslpath -w "$KEY" 2>/dev/null || echo "C:${KEY#/mnt/c}") ;;
    /c/*) key_win="C:${KEY#/c}" ;;
  esac
  case "$src" in
    /mnt/c/*) src_win=$(wslpath -w "$src" 2>/dev/null || echo "C:${src#/mnt/c}") ;;
    /c/*) src_win="C:${src#/c}" ;;
  esac
  # Git Bash often gives /c/Users/... — scp.exe wants C:\Users\...
  if command -v cygpath >/dev/null 2>&1; then
    src_win=$(cygpath -w "$src")
    case "$KEY" in
      /*) key_win=$(cygpath -w "$KEY") ;;
    esac
  fi
  if command -v scp.exe >/dev/null 2>&1; then
    scp.exe -i "$key_win" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$src_win" "$HOST:$dst"
  else
    scp -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new "$src" "$HOST:$dst"
  fi
}
ram_avail() {
  ssh_run "free -m" | awk '/^Mem:/{print $7}'
}

echo "=== RAM before ==="
BEFORE="$(ram_avail)"
echo "available_mb=$BEFORE"
if [[ "${BEFORE:-0}" -lt 1500 ]]; then
  echo "STOP: available RAM under 1.5 GB ($BEFORE)." >&2
  exit 1
fi

echo "=== build API locally ==="
(
  cd "$API_SRC"
  npm run build
  npm test
)

echo "=== 1 install docker + daftar user ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo "RAM_BEFORE"; free -m
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq docker.io docker-compose-v2
  systemctl enable --now docker
fi
docker --version
docker compose version
id daftar >/dev/null 2>&1 || useradd --system --home /opt/daftar-api --shell /usr/sbin/nologin daftar
usermod -aG docker daftar || true
mkdir -p /opt/daftar-api /opt/daftar-pg /var/backups/daftar-pg /root/nginx-backups
echo "RAM_AFTER_DOCKER"; free -m
REMOTE

AFTER_DOCKER="$(ram_avail)"
echo "available_mb_after_docker=$AFTER_DOCKER"
if [[ "${AFTER_DOCKER:-0}" -lt 1500 ]]; then
  echo "STOP: RAM under 1.5 GB after docker ($AFTER_DOCKER)." >&2
  exit 1
fi

echo "=== 2 secrets ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
ENV=/etc/daftar-api.env
if [[ ! -f "$ENV" ]]; then
  PG_PASS=$(openssl rand -hex 24)
  OWNER_PASS=$(openssl rand -hex 16)
  KEY=$(openssl rand -hex 32)
  umask 077
  cat > "$ENV" <<EOF
HOST=127.0.0.1
PORT=8787
DATABASE_URL=postgres://daftar:${PG_PASS}@127.0.0.1:5433/daftar
SESSION_DAYS=7
COOKIE_NAME=daftar_session
COOKIE_SECURE=true
CORS_ORIGIN=https://sheikhmahboob.com,https://www.sheikhmahboob.com
BODY_LIMIT_BYTES=33554432
LOGIN_MAX_FAILURES=5
LOGIN_LOCK_MINUTES=15
DAFTAR_PG_PASSWORD=${PG_PASS}
NODE_ENV=production
TOKEN_ENCRYPTION_KEY=${KEY}
EOF
  chmod 600 "$ENV"
  chown root:root "$ENV"
  printf 'email=owner@sheikhmahboob.com\npassword=%s\n' "$OWNER_PASS" > /root/daftar-owner.credentials
  chmod 600 /root/daftar-owner.credentials
  echo CREATED_ENV
else
  echo ENV_EXISTS
fi
# M2: ensure TOKEN_ENCRYPTION_KEY exists (root-only .env). Never print the value.
if ! grep -q '^TOKEN_ENCRYPTION_KEY=' "$ENV" 2>/dev/null; then
  KEY=$(openssl rand -hex 32)
  umask 077
  printf '\nTOKEN_ENCRYPTION_KEY=%s\n' "$KEY" >> "$ENV"
  chmod 600 "$ENV"
  echo TOKEN_KEY_ADDED
else
  echo TOKEN_KEY_EXISTS
fi
REMOTE

echo "=== 3 upload code + compose ==="
STAGE="$ROOT/.tmp-daftar-deploy"
rm -rf "$STAGE"
mkdir -p "$STAGE/daftar-api/src"
cp "$API_SRC/package.json" "$API_SRC/package-lock.json" "$STAGE/daftar-api/"
cp -R "$API_SRC/dist" "$STAGE/daftar-api/dist"
cp -R "$API_SRC/src/sql" "$STAGE/daftar-api/src/sql"
tar -C "$STAGE" -czf "$STAGE/bundle.tgz" daftar-api
scp_to "$STAGE/bundle.tgz" /tmp/daftar-api.tgz
scp_to "$HERE/daftar/docker-compose.yml" /opt/daftar-pg/docker-compose.yml
scp_to "$HERE/daftar/daftar-api.service" /tmp/daftar-api.service
scp_to "$HERE/daftar/dump-remote.sh" /tmp/daftar-pg-dump.sh
rm -rf "$STAGE"

ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
set -a
# shellcheck disable=SC1091
source /etc/daftar-api.env
set +a

install -d -o daftar -g daftar /opt/daftar-api
rm -rf /opt/daftar-api/*
tar -xzf /tmp/daftar-api.tgz -C /opt --strip-components=0
# tarball contains daftar-api/...
chown -R daftar:daftar /opt/daftar-api
rm -f /tmp/daftar-api.tgz

install -m 0755 /tmp/daftar-pg-dump.sh /usr/local/sbin/daftar-pg-dump
rm -f /tmp/daftar-pg-dump.sh

cd /opt/daftar-pg
umask 077
printf 'DAFTAR_PG_PASSWORD=%s\n' "$DAFTAR_PG_PASSWORD" > .env
chmod 600 .env
docker compose up -d
for i in $(seq 1 40); do
  if docker exec daftar-pg pg_isready -U daftar -d daftar >/dev/null 2>&1; then
    echo PG_READY
    break
  fi
  sleep 2
done
docker exec daftar-pg pg_isready -U daftar -d daftar

cd /opt/daftar-api
sudo -u daftar npm ci --omit=dev

# migrate (compiled)
sudo -u daftar env \
  DATABASE_URL="$DATABASE_URL" \
  TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY" \
  NODE_ENV="${NODE_ENV:-production}" \
  node dist/src/migrate.js

install -m 0644 /tmp/daftar-api.service /etc/systemd/system/daftar-api.service
rm -f /tmp/daftar-api.service
systemctl daemon-reload
systemctl enable --now daftar-api.service
sleep 2
systemctl --no-pager --full status daftar-api.service | head -20
curl -sS -o /dev/null -w "health_local=%{http_code}\n" http://127.0.0.1:8787/v1/health
ss -ltn | grep -E '5433|8787' || true
echo RAM_AFTER_API; free -m
REMOTE

AFTER_API="$(ram_avail)"
echo "available_mb_after_api=$AFTER_API"
if [[ "${AFTER_API:-0}" -lt 1500 ]]; then
  echo "STOP: RAM under 1.5 GB after API ($AFTER_API)." >&2
  exit 1
fi

echo "=== 4 nginx /pra-api/ ==="
scp_to "$NGINX_SRC" "/root/sheikhmahboob.conf.daftar-$STAMP"
ssh_run "bash -s" <<REMOTE
set -euo pipefail
STAMP='$STAMP'
cp -a /etc/nginx/conf.d/sheikhmahboob.conf "/root/nginx-backups/sheikhmahboob.conf.\$STAMP"
cp "/root/sheikhmahboob.conf.daftar-\$STAMP" /etc/nginx/conf.d/sheikhmahboob.conf
nginx -t
systemctl reload nginx
code_login=\$(curl -sS -o /dev/null -w '%{http_code}' https://sheikhmahboob.com/login)
code_pra=\$(curl -sS -o /dev/null -w '%{http_code}' https://sheikhmahboob.com/pra/)
echo "login=\$code_login pra=\$code_pra"
if [[ "\$code_login" != "200" || "\$code_pra" != "200" ]]; then
  echo ROLLBACK_NGINX
  cp -a "/root/nginx-backups/sheikhmahboob.conf.\$STAMP" /etc/nginx/conf.d/sheikhmahboob.conf
  nginx -t && systemctl reload nginx
  exit 1
fi
REMOTE

echo "=== 5 create owner ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
set -a; source /etc/daftar-api.env; set +a
if [[ ! -f /root/daftar-owner.credentials ]]; then
  OWNER_PASS=$(openssl rand -hex 16)
  umask 077
  printf 'email=owner@sheikhmahboob.com\npassword=%s\n' "$OWNER_PASS" > /root/daftar-owner.credentials
  chmod 600 /root/daftar-owner.credentials
fi
EMAIL=$(awk -F= '/^email=/{print $2}' /root/daftar-owner.credentials)
PASS=$(awk -F= '/^password=/{print $2}' /root/daftar-owner.credentials)
cd /opt/daftar-api
sudo -u daftar env \
  DATABASE_URL="$DATABASE_URL" \
  TOKEN_ENCRYPTION_KEY="$TOKEN_ENCRYPTION_KEY" \
  NODE_ENV="${NODE_ENV:-production}" \
  node dist/scripts/create-owner.js --email "$EMAIL" --password "$PASS"
echo "OWNER_OK $EMAIL"
REMOTE

echo "=== 6 prove pra-api ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
printf 'GET health: '; curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/pra-api/v1/health
EMAIL=$(awk -F= '/^email=/{print $2}' /root/daftar-owner.credentials)
PASS=$(awk -F= '/^password=/{print $2}' /root/daftar-owner.credentials)
printf 'POST login no Origin: '
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  --data-binary "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  https://sheikhmahboob.com/pra-api/v1/auth/login
printf 'POST login good Origin: '
curl -sS -o /tmp/daftar-login.json -w '%{http_code}\n' -X POST \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://sheikhmahboob.com' \
  --data-binary "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  https://sheikhmahboob.com/pra-api/v1/auth/login
python3 -c "import json; d=json.load(open('/tmp/daftar-login.json')); print('token' if d.get('token') else d)"
REMOTE

echo "=== 7 cron dump ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
echo '15 2 * * * root /usr/local/sbin/daftar-pg-dump >> /var/log/daftar-pg-dump.log 2>&1' > /etc/cron.d/daftar-pg-dump
chmod 644 /etc/cron.d/daftar-pg-dump
/usr/local/sbin/daftar-pg-dump
ls -la /var/backups/daftar-pg | tail -5
REMOTE

echo "=== 8 final ==="
ssh_run 'bash -s' <<'REMOTE'
set -euo pipefail
free -m
printf 'login='; curl -sS -o /dev/null -w '%{http_code}' https://sheikhmahboob.com/login; echo
printf 'pra='; curl -sS -o /dev/null -w '%{http_code}' https://sheikhmahboob.com/pra/; echo
REMOTE
echo "DEPLOY_DAFTAR_API_OK"
echo "Owner file on VPS: /root/daftar-owner.credentials (root-only)."
