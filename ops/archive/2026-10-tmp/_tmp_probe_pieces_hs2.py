"""Probe more HS codes for soap/detergent/spray/tissue/cotton that allow pieces."""

import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()

from di.integrations.reference_api import fetch_hs_code_uom

SELLER = "SUBHAN ENTERPRISES"
PIECES = "Numbers, pieces, units"

needles = (
	"%SOAP%",
	"%DETERGENT%",
	"%WASHING%",
	"%INSECT%",
	"%DISINFECT%",
	"%AEROSOL%",
	"%TISSUE%",
	"%TOILET PAPER%",
	"%COTTON%",
	"%MOP%",
	"%SCOUR%",
	"%POLISH%",
	"%PHENYL%",
	"%ACID%",
)

rows = frappe.db.sql(
	"""
	select hs_code, short_description, uom
	from `tabHS Code`
	where short_description like %s
	   or short_description like %s
	   or short_description like %s
	   or short_description like %s
	   or short_description like %s
	   or ifnull(description,'') like %s
	order by hs_code
	limit 80
	""",
	("%soap%", "%detergent%", "%insect%", "%disinfect%", "%tissue%", "%aerosol%"),
	as_dict=True,
)
print("MATCH", len(rows))
for r in rows[:60]:
	print("ROW", r.hs_code, r.uom, (r.short_description or "")[:80])

extra = [
	"3401.1100",
	"3401.1900",
	"3401.3000",
	"3402.1110",
	"3402.1190",
	"3402.1290",
	"3402.1900",
	"3402.3100",
	"3402.3900",
	"3402.9000",
	"3405.2000",
	"3808.9110",
	"3808.9190",
	"3808.9400",
	"3808.9910",
	"9616.1000",
	"9616.2000",
	"6307.1010",
	"6307.1020",
	"6307.1030",
	"6307.2000",
	"5204.1900",
	"5208.5200",
	"5603.9100",
	"4803.0000",
	"4818.2000",
	"2710.9100",
	"2620.1100",
]
probe = []
for hs in extra:
	if frappe.db.exists("HS Code", hs):
		probe.append(hs)
for r in rows:
	if r.hs_code not in probe:
		probe.append(r.hs_code)
probe = probe[:35]
print("PROBE", probe)
for hs in probe:
	cached = (frappe.db.get_value("HS Code", hs, "uom") or "").strip()
	if cached:
		print("CACHE", hs, cached, frappe.db.get_value("HS Code", hs, "short_description"))
		continue
	try:
		uom = fetch_hs_code_uom(hs, company=SELLER)
	except Exception as e:
		uom = f"ERR {e}"
	print("UOM", hs, uom, frappe.db.get_value("HS Code", hs, "short_description"))

frappe.destroy()
