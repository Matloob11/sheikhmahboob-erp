"""Find HS codes on site whose FBR UOM is Numbers/pieces. No invoice write."""

import json

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.reference_api import fetch_hs_code_uom

SELLER = "SUBHAN ENTERPRISES"
PIECES = "Numbers, pieces, units"

prefixes = (
	"9603",
	"3924",
	"3922",
	"4818",
	"3307",
	"8301",
	"6307",
	"3401",
	"3402",
	"3808",
	"4417",
	"5208",
	"5601",
	"7323",
	"7615",
)

found = frappe.db.sql(
	"""
	select hs_code, short_description, uom
	from `tabHS Code`
	where left(hs_code, 4) in %(p)s
	order by hs_code
	""",
	{"p": prefixes},
	as_dict=True,
)
print("CANDIDATE_COUNT", len(found))

# Prefer already-cached pieces
cached_pieces = [r for r in found if (r.uom or "") == PIECES]
print("CACHED_PIECES", json.dumps(cached_pieces[:80], default=str))

# Probe a focused set if they exist
want = [
	"9603.1000",
	"9603.1010",
	"9603.1090",
	"9603.2100",
	"9603.2900",
	"9603.9000",
	"3924.1000",
	"3924.9000",
	"3922.2000",
	"4818.1000",
	"4818.2000",
	"4818.3000",
	"3307.4900",
	"3307.2000",
	"3307.9000",
	"8301.1000",
	"8301.4000",
	"6307.1000",
	"6307.9000",
	"3401.2000",
	"3402.2000",
	"3808.9100",
	"4417.0000",
	"7323.9900",
	"5601.2100",
]

print("EXISTS")
for hs in want:
	print(hs, bool(frappe.db.exists("HS Code", hs)), frappe.db.get_value("HS Code", hs, ["short_description", "uom"]) if frappe.db.exists("HS Code", hs) else None)

# Fetch UOM for existing wanted codes + a few from DB matching 9603/3924/4818/3307/8301
probe = []
for hs in want:
	if frappe.db.exists("HS Code", hs):
		probe.append(hs)
for r in found:
	if r.hs_code[:4] in ("9603", "3924", "4818", "3307", "8301") and r.hs_code not in probe:
		probe.append(r.hs_code)
probe = probe[:40]

print("PROBE", probe)
for hs in probe:
	frappe.db.set_value("HS Code", hs, "uom", "", update_modified=False)
frappe.db.commit()
results = []
for hs in probe:
	try:
		uom = fetch_hs_code_uom(hs, company=SELLER)
	except Exception as e:
		uom = f"ERR {e}"
	desc = frappe.db.get_value("HS Code", hs, "short_description")
	results.append({"hs": hs, "uom": uom, "desc": desc})
	print("UOM", hs, uom, desc)

print("PIECES_HITS", [r for r in results if r["uom"] == PIECES])
frappe.destroy()
