#!/bin/bash
set -euo pipefail
BENCH=/home/frappe/frappe-bench
APP=$BENCH/apps/di
chown -R frappe:frappe "$APP/di/digital_invoicing/doctype/sale_tax_invoice" \
  "$APP/di/invoice_picker.py" \
  "$APP/di/tests/test_invoice_picker.py"
sudo -u frappe bash -lc "cd $BENCH && bench build --app di && bench --site sheikhmahboob.com migrate && bench --site sheikhmahboob.com clear-cache && bench --site sheikhmahboob.com clear-website-cache"
sudo -u frappe bash -lc "cd $BENCH/sites && ../env/bin/python - <<'PY'
import frappe
frappe.init(site='sheikhmahboob.com')
frappe.connect()
for name in frappe.get_all('Sale Tax Invoice', filters={'owner': 'subhan.enterprise12@gmail.com', 'docstatus': 0}, pluck='name'):
    frappe.db.set_value('Sale Tax Invoice', name, 'fbr_environment', 'Production', update_modified=False)
    print('SET_PROD', name)
# Confirm field default
meta = frappe.get_meta('Sale Tax Invoice')
df = meta.get_field('fbr_environment')
print('DEFAULT', df.default if df else None)
frappe.db.commit()
frappe.clear_cache()
frappe.destroy()
PY"
echo DEPLOY_OK
