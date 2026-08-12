"""Delete HS Code records whose code is not a well-formed FBR code.

The bundled apps/di/di/data/hs_codes.json is a bad scrape: of its 7,767 rows,
only 6 have an eight-digit NNNN.NNNN code. The rest are fragments such as ".2",
"2.29" or "2.292", produced by splitting descriptions on the decimal point.
Seeding them created ~3,861 junk HS Code records that users can pick from the
link field and that FBR rejects on submission.

seed_data.py now refuses to create them (HS_CODE_PATTERN), so this script only
has to clean up what earlier seeds already wrote. The real HS Code master comes
from di.integrations.reference_api.sync_hs_codes().

The script refuses to delete anything that is still referenced.

Run it against instance B only:

    scp -i C:/Users/Matloob/.ssh/hostinger_codex ops/purge_malformed_hs_codes.py root@187.127.123.235:/tmp/
    ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 \
      "su - frappe -c 'cd /home/frappe/frappe-bench-b && bench --site sheikhmahboob.com console < /tmp/purge_malformed_hs_codes.py'"

Take a backup first:

    ssh -i C:/Users/Matloob/.ssh/hostinger_codex root@187.127.123.235 \
      "su - frappe -c 'cd /home/frappe/frappe-bench-b && bench --site sheikhmahboob.com backup'"
"""

import re

import frappe

valid = re.compile(r"^[0-9]{4}\.[0-9]{4}$")
names = frappe.get_all("HS Code", pluck="name", limit_page_length=0)
bad = [n for n in names if not valid.match(str(n))]
print("PURGE total_rows:", len(names))
print("PURGE candidates:", len(bad))
print("PURGE sample:", bad[:15])

refs = [
    ("Item", "hs_code"),
    ("Sales Invoice Item", "di_hs_code"),
    ("Purchase Invoice Item", "di_hs_code"),
    ("Tax Item", "hs_code"),
]

in_use = 0
for doctype, field in refs:
    n = frappe.db.count(doctype, {field: ["in", bad]}) if frappe.db.exists("DocType", doctype) else 0
    print(f"PURGE refs {doctype}.{field}: {n}")
    in_use += n

print("PURGE total_in_use:", in_use)

deleted = 0
if in_use:
    print("PURGE ABORTED - some malformed codes are still referenced. Fix those records first.")
elif bad:
    frappe.db.delete("HS Code", {"name": ["in", bad]})
    frappe.db.commit()
    deleted = len(bad)

print("PURGE deleted:", deleted)
print("PURGE remaining_rows:", frappe.db.count("HS Code"))
left = [n for n in frappe.get_all("HS Code", pluck="name", limit_page_length=0) if not valid.match(str(n))]
print("PURGE remaining_malformed:", len(left))
