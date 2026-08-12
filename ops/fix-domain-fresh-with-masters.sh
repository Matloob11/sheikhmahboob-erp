#!/usr/bin/env bash
# Reset domain site (sheikhmahboob.com / erp_b) to a FRESH client:
#   - no old companies / buyers / invoices / DI tokens
#   - keep software masters: HS Code, HS Uom, UOM, Province, Sale/Transaction
#     types, SRO*, Scenario*, DI Error Code (not Tax Item — that is client catalog)
#
# Run as root on the Hostinger VPS.
set -euo pipefail

BENCH_A=/home/frappe/frappe-bench
BENCH_B=/home/frappe/frappe-bench-b
SITE_A=187.127.123.235
SITE_B=sheikhmahboob.com
DB_A=_dd4d7ef3e3991574
DB_B=erp_b
DBROOT_FILE=/root/.frappe-db-root-password
ADMIN_FILE=/root/${SITE_B}-admin-password.txt
DUMP=/tmp/di-software-masters-$$.sql

DBROOT=$(tr -d '\r\n' < "$DBROOT_FILE")
ADMINPW=$(openssl rand -hex 16)
install -m 600 /dev/null "$ADMIN_FILE"
printf '%s\n' "$ADMINPW" > "$ADMIN_FILE"

MASTER_TABLES=(
  "tabHS Uom"
  "tabUOM"
  "tabUOM Conversion Factor"
  "tabProvince"
  "tabSale Type"
  "tabTransaction Type"
  "tabDI Error Code"
  "tabScenario"
  "tabSandbox Scenario"
  "tabSRO Schedule"
  "tabSRO Item"
  "tabHS Code"
  # Tax Item is per-client product catalog (often test rows) — do NOT copy to fresh domain.
)

echo "=== 1/7 dump software masters from instance A ($DB_A) ==="
TABLE_ARGS=()
for t in "${MASTER_TABLES[@]}"; do
  TABLE_ARGS+=("$t")
done
# --complete-insert is required: A and B can have the same columns in a
# different physical order (e.g. HS Code / Tax Item after patch upgrades).
# A positional REPLACE puts description into _assign and list view then dies
# with json.decoder.JSONDecodeError on those JSON meta fields.
mysqldump -u root -p"$DBROOT" \
  --single-transaction --quick --skip-triggers --no-create-info --replace \
  --complete-insert \
  "$DB_A" "${TABLE_ARGS[@]}" > "$DUMP"
ls -lh "$DUMP"
grep -c "INSERT\|REPLACE" "$DUMP" || true

echo "=== 2/7 stop instance B processes ==="
supervisorctl stop 'frappe-bench-b-web:*' 'frappe-bench-b-workers:*' || true
sleep 2

echo "=== 3/7 drop domain site (keeps bench-b apps) ==="
sudo -H -u frappe env DBROOT="$DBROOT" bash -lc "
set -euo pipefail
cd '$BENCH_B'
if [[ -d sites/$SITE_B ]]; then
  bench drop-site '$SITE_B' --db-root-password \"\$DBROOT\" --force
fi
"

echo "=== 4/7 create fresh site + install apps (DI seeds HS codes/UOMs) ==="
sudo -H -u frappe env DBROOT="$DBROOT" ADMINPW="$ADMINPW" bash -lc "
set -euo pipefail
cd '$BENCH_B'
bench new-site '$SITE_B' \
  --db-name '$DB_B' \
  --admin-password \"\$ADMINPW\" \
  --mariadb-root-password \"\$DBROOT\" \
  --no-mariadb-socket
bench --site '$SITE_B' install-app erpnext
bench --site '$SITE_B' install-app di
bench --site '$SITE_B' set-config host_name 'https://$SITE_B'
# Frappe sometimes omits encryption_key until first password write — force one now.
python3 -c \"import json,base64,os; from pathlib import Path; p=Path('sites/$SITE_B/site_config.json'); d=json.loads(p.read_text());
print('encryption_key ok') if d.get('encryption_key') else (d.__setitem__('encryption_key', base64.b64encode(os.urandom(32)).decode()) or p.write_text(json.dumps(d, indent=1, sort_keys=True)+chr(10)) or print('encryption_key generated'))\"
bench --site '$SITE_B' clear-cache
"

echo "=== 5/7 import masters from A (overwrite seed with synced masters) ==="
mariadb -u root -p"$DBROOT" "$DB_B" -e "SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0;"
mariadb -u root -p"$DBROOT" "$DB_B" < "$DUMP"
mariadb -u root -p"$DBROOT" "$DB_B" -e "SET FOREIGN_KEY_CHECKS=1; SET UNIQUE_CHECKS=1;"
rm -f "$DUMP"

# Ensure no client transactional leftovers leaked (should already be empty)
mariadb -u root -p"$DBROOT" "$DB_B" -e "
  SET FOREIGN_KEY_CHECKS=0;
  DELETE FROM \`tabBuyer\`;
  DELETE FROM \`tabSeller Or Company\`;
  DELETE FROM \`tabSale Tax Invoice Item\`;
  DELETE FROM \`tabSale Tax Invoice\`;
  DELETE FROM \`tabDI Log\`;
  DELETE FROM \`tabDI Settings\`;
  DELETE FROM \`tabCompany Sale Type\`;
  DELETE FROM \`tabCompany Sandbox Scenario\`;
  TRUNCATE TABLE \`tabCompany\`;
  TRUNCATE TABLE \`tabTax Item\`;
  SET FOREIGN_KEY_CHECKS=1;
" 2>/dev/null || true

sudo -H -u frappe bash -lc "
cd '$BENCH_B'
bench --site '$SITE_B' clear-cache
bench --site '$SITE_B' clear-website-cache || true
"

echo "=== 6/7 clean stale domain list on instance A ==="
sudo -H -u frappe bash -lc "
cd '$BENCH_A'
python3 - <<'PY'
import json
from pathlib import Path
p = Path('sites/$SITE_A/site_config.json')
d = json.loads(p.read_text())
domains = d.get('domains') or []
if isinstance(domains, list):
    cleaned = [x for x in domains if x not in ('sheikhmahboob.com', 'www.sheikhmahboob.com')]
    if cleaned != domains:
        if cleaned:
            d['domains'] = cleaned
        else:
            d.pop('domains', None)
        p.write_text(json.dumps(d, indent=1, sort_keys=True) + '\n')
        print('cleared stale domains from A:', domains, '->', cleaned)
    else:
        print('A domains already clean:', domains)
else:
    print('A domains key:', domains)
PY
bench --site '$SITE_A' set-config host_name 'http://187.127.123.235:8001'
bench --site '$SITE_A' clear-cache
"

echo "=== 7/7 start B + verify ==="
supervisorctl start 'frappe-bench-b-web:*' 'frappe-bench-b-workers:*' || supervisorctl update
sleep 3
supervisorctl status | grep frappe-bench-b || true

echo "--- counts A vs B ---"
for db in "$DB_A" "$DB_B"; do
  echo "DB $db"
  mariadb -u root -p"$DBROOT" -N -e "
    SELECT 'HS Code', COUNT(*) FROM \`$db\`.\`tabHS Code\`;
    SELECT 'HS Uom', COUNT(*) FROM \`$db\`.\`tabHS Uom\`;
    SELECT 'UOM', COUNT(*) FROM \`$db\`.\`tabUOM\`;
    SELECT 'Province', COUNT(*) FROM \`$db\`.\`tabProvince\`;
    SELECT 'Sale Type', COUNT(*) FROM \`$db\`.\`tabSale Type\`;
    SELECT 'Transaction Type', COUNT(*) FROM \`$db\`.\`tabTransaction Type\`;
    SELECT 'SRO Item', COUNT(*) FROM \`$db\`.\`tabSRO Item\`;
    SELECT 'SRO Schedule', COUNT(*) FROM \`$db\`.\`tabSRO Schedule\`;
    SELECT 'Company', COUNT(*) FROM \`$db\`.\`tabCompany\`;
    SELECT 'Buyer', COUNT(*) FROM \`$db\`.\`tabBuyer\`;
    SELECT 'Sale Tax Invoice', COUNT(*) FROM \`$db\`.\`tabSale Tax Invoice\`;
    SELECT 'Seller Or Company', COUNT(*) FROM \`$db\`.\`tabSeller Or Company\`;
  "
done

echo "--- encryption_key on B ---"
python3 - <<PY
import json
d=json.load(open("$BENCH_B/sites/$SITE_B/site_config.json"))
print("encryption_key=", "YES" if d.get("encryption_key") else "MISSING")
print("host_name=", d.get("host_name"))
print("db_name=", d.get("db_name"))
PY

echo "--- HTTP ---"
curl -sS -o /dev/null -w 'domain=%{http_code}\n' https://sheikhmahboob.com/ || true
curl -sS -o /dev/null -w 'ip8001=%{http_code}\n' http://187.127.123.235:8001/ || true
curl -sS -o /dev/null -w 'B_local=%{http_code}\n' -H "Host: sheikhmahboob.com" http://127.0.0.1:8002/ || true

echo
echo "DONE."
echo "Fresh domain Administrator password saved at: $ADMIN_FILE"
cat "$ADMIN_FILE"
echo
unset DBROOT ADMINPW
