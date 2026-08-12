#!/usr/bin/env bash
# Create instance B's site (sheikhmahboob.com) and restore instance A's data into it.
#
# Copy to the server, then run as the frappe user:
#   scp -i C:/Users/Matloob/.ssh/hostinger_codex ops/create-instance-b.sh root@187.127.123.235:/home/frappe/
#   ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 \
#       'chown frappe:frappe /home/frappe/create-instance-b.sh && chmod 700 /home/frappe/create-instance-b.sh'
#   ssh -t -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 \
#       'su - frappe -c /home/frappe/create-instance-b.sh'
#
# Passwords are read interactively and never written to disk, shell history, or logs.

set -euo pipefail

BENCH_B=/home/frappe/frappe-bench-b
SITE_B=sheikhmahboob.com
DB_B=erp_b
BACKUP=/home/frappe/frappe-bench/sites/187.127.123.235/private/backups/20260811_230347-187_127_123_235

for f in "$BACKUP-database.sql.gz" "$BACKUP-files.tar" "$BACKUP-private-files.tar"; do
    if [[ ! -f "$f" ]]; then
        echo "Backup file missing: $f" >&2
        exit 1
    fi
done

read -rsp "MariaDB root password: " DBROOT; echo
read -rsp "New Administrator password for instance B: " ADMINPW; echo

if [[ -z "$DBROOT" || -z "$ADMINPW" ]]; then
    echo "Both passwords are required." >&2
    exit 1
fi

cd "$BENCH_B"

echo "=== 1/5 creating site $SITE_B (db $DB_B) ==="
bench new-site "$SITE_B" \
    --db-name "$DB_B" \
    --admin-password "$ADMINPW" \
    --mariadb-root-password "$DBROOT" \
    --no-mariadb-socket

echo "=== 2/5 restoring instance A data ==="
bench --site "$SITE_B" restore "$BACKUP-database.sql.gz" \
    --with-public-files  "$BACKUP-files.tar" \
    --with-private-files "$BACKUP-private-files.tar" \
    --mariadb-root-password "$DBROOT" \
    --force

echo "=== 3/5 migrating data to this bench's app versions ==="
bench --site "$SITE_B" migrate

echo "=== 4/5 resetting Administrator password ==="
# The restore brings instance A's Administrator password with it.
# Reset it so the two instances share no login.
bench --site "$SITE_B" set-admin-password "$ADMINPW"

echo "=== 5/5 setting host_name ==="
bench --site "$SITE_B" set-config host_name "https://$SITE_B"
bench --site "$SITE_B" clear-cache

unset DBROOT ADMINPW

echo
echo "DONE. Site $SITE_B created in $BENCH_B."
echo "Next: encryption key decision, supervisor setup, then the nginx cutover."
