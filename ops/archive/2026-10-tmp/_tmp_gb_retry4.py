from copy import deepcopy

import di.integrations.di_api as di_api
import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.di_api import _is_valid_response
from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice
from di.sandbox_drafts import format_fbr_validation_errors
from frappe.utils import nowdate

frappe.set_user("Administrator")

SELLER = "Golden Ball International"
REG = "Sandbox Registered Buyer (Golden Ball International)"
RATE_FMT = {}
EXTRA_ITEM_FIELDS = {}

_orig_format = di_api._format_rate
_orig_build = sti_api._build_item_payload


def _patched_format(percentage, sale_type):
	if sale_type in RATE_FMT:
		return RATE_FMT[sale_type]
	return _orig_format(percentage, sale_type)


def _patched_build(row):
	payload = _orig_build(row)
	payload.update(EXTRA_ITEM_FIELDS)
	return payload


di_api._format_rate = _patched_format
sti_api._format_rate = _patched_format
sti_api._build_item_payload = _patched_build


def update_item(name, hs, uom, tax_desc, rate, fixed=0):
	doc = frappe.get_doc("Tax Item", name)
	doc.hs_code = hs
	doc.product_uom = uom
	doc.tax_desc = tax_desc
	doc.rate_in_p = rate
	doc.fixed_rs = fixed
	doc.save(ignore_permissions=True)
	frappe.db.commit()


def get_draft(sn, item, sale_rate=1000, qty=1):
	names = frappe.get_all(
		"Sale Tax Invoice",
		filters={"seller__business_name": SELLER, "scenario_id": sn, "docstatus": 0},
		pluck="name",
		order_by="creation desc",
	)
	if names:
		doc = frappe.get_doc("Sale Tax Invoice", names[0])
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Sale Tax Invoice",
				"invoice_type": "Sale Invoice",
				"invoice_date": nowdate(),
				"scenario_id": sn,
				"fbr_environment": "Sandbox",
				"buyer": REG,
				"seller__business_name": SELLER,
				"invoice_items": [{"description": item, "quantity": qty, "sale_rate": sale_rate}],
			}
		)
		doc.insert(ignore_permissions=True)
		frappe.db.commit()
		doc = frappe.get_doc("Sale Tax Invoice", doc.name)
	row = doc.invoice_items[0]
	row.description = item
	row.quantity = qty
	row.sale_rate = sale_rate
	doc.fbr_environment = "Sandbox"
	return doc


def save_line(doc, sro="", serial="", extra=0, fixed=None):
	row = doc.invoice_items[0]
	row.sro_schedule_no = sro
	row.sro_item_serial_no = serial
	row.extra_tax = extra
	if fixed is not None:
		row.fixed_notified_value_or_retail_price = fixed
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return frappe.get_doc("Sale Tax Invoice", doc.name)


def check(doc):
	try:
		resp = validate_sale_tax_invoice(doc)
	except Exception as exc:
		return False, str(exc)[:400]
	if _is_valid_response(resp):
		return True, ""
	return False, format_fbr_validation_errors(resp)[:400]


def submit_ok(doc, sn):
	doc.reload()
	doc.submit()
	frappe.db.commit()
	doc.reload()
	print("POSTED", sn, doc.name, doc.fbr_invoice_no)
	return doc.fbr_invoice_no


posted = []
failed = []

# --- SN004 ship scrap ---
RATE_FMT.clear()
EXTRA_ITEM_FIELDS.clear()
update_item("SN004 Golden Ball International", "7204.1010", "MT", "18%", 18)
doc = get_draft("SN004", "SN004 Golden Ball International", 1000, 1)
doc = save_line(doc)
ok, reason = check(doc)
print("SN004", "OK" if ok else reason)
if ok:
	posted.append(("SN004", submit_ok(doc, "SN004")))
else:
	failed.append(("SN004", reason))

# --- SN022 chlorate ---
RATE_FMT.clear()
EXTRA_ITEM_FIELDS.clear()
RATE_FMT["Potassium Chlorate"] = "18% along with rupees 60 per kilogram"
update_item("SN022 Golden Ball International", "2829.1910", "KG", "18%", 18, 60)
doc = get_draft("SN022", "SN022 Golden Ball International", 1000, 1)
doc = save_line(doc, "EIGHTH SCHEDULE Table 1", "56", extra=0, fixed=60)
# tax = 18% of 1000 + 60
doc.invoice_items[0].sales_tax_applicable = 240
doc.invoice_items[0].total_values = 1240
ok, reason = check(doc)
print("SN022 official-rate", "OK" if ok else reason)
if not ok:
	RATE_FMT["Potassium Chlorate"] = "18% + Rs.60/kg"
	ok, reason = check(doc)
	print("SN022 blog-rate", "OK" if ok else reason)
if ok:
	posted.append(("SN022", submit_ok(doc, "SN022")))
else:
	failed.append(("SN022", reason))

# --- SN023 CNG ---
RATE_FMT.clear()
EXTRA_ITEM_FIELDS.clear()
RATE_FMT["CNG Sales"] = "Rs.200"
update_item("SN023 Golden Ball International", "2711.2100", "KG", "Rs.200", 200)
doc = get_draft("SN023", "SN023 Golden Ball International", 100, 1)
doc = save_line(doc, "581(1)/2024", "Region-I")
ok, reason = check(doc)
print("SN023 Region-I KG", "OK" if ok else reason)
if not ok:
	doc = save_line(doc, "581(1)/2024", "Region-II")
	ok, reason = check(doc)
	print("SN023 Region-II", "OK" if ok else reason)
if not ok:
	update_item("SN023 Golden Ball International", "2711.2100", "MMBTU", "Rs.200", 200)
	doc = get_draft("SN023", "SN023 Golden Ball International", 100, 1)
	doc = save_line(doc, "581(1)/2024", "Region-I")
	ok, reason = check(doc)
	print("SN023 MMBTU", "OK" if ok else reason)
if not ok:
	RATE_FMT["CNG Sales"] = "Rs.200/unit"
	ok, reason = check(doc)
	print("SN023 Rs.200/unit", "OK" if ok else reason)
if ok:
	posted.append(("SN023", submit_ok(doc, "SN023")))
else:
	failed.append(("SN023", reason))

# --- SN012 petroleum levy field hunt ---
RATE_FMT.clear()
update_item("SN012 Golden Ball International", "2710.1911", "KG", "18%", 18)
doc = get_draft("SN012", "SN012 Golden Ball International", 1000, 1)
doc = save_line(doc)
levy_tries = [
	{"petroleumLevyOn": 1},
	{"petroleumLevyOn": 0},
	{"petroleumLevyOn": 1.0},
	{"petroleumLevyOn": "1"},
	{"petroleumLevyOn": "HSD"},
	{"petroleumLevyOn": "MS"},
	{"petroleumLevyOn": "HOBC"},
	{"petroleumLevyOn": "Yes"},
	{"PetroleumLevyOn": 1},
	{"petroleum_levy_on": 1},
	{"petrolumLevyOn": 1},
	{"petroleumLevy": 1},
	{"levyOn": "HSD"},
	{"plOn": 1},
]
found = False
for extra in levy_tries:
	EXTRA_ITEM_FIELDS.clear()
	EXTRA_ITEM_FIELDS.update(extra)
	ok, reason = check(doc)
	print("SN012", extra, "OK" if ok else reason)
	if ok:
		posted.append(("SN012", submit_ok(doc, "SN012")))
		found = True
		break
if not found:
	# 1.43% + SRO + levy
	update_item("SN012 Golden Ball International", "2710.1911", "KG", "1.43%", 1.43)
	doc = get_draft("SN012", "SN012 Golden Ball International", 1000, 1)
	doc = save_line(doc, "1450(I)/2021", "1")
	for extra in ({"petroleumLevyOn": 1}, {"petroleumLevyOn": "HSD"}):
		EXTRA_ITEM_FIELDS.clear()
		EXTRA_ITEM_FIELDS.update(extra)
		ok, reason = check(doc)
		print("SN012 1.43", extra, "OK" if ok else reason)
		if ok:
			posted.append(("SN012", submit_ok(doc, "SN012")))
			found = True
			break
if not found:
	failed.append(("SN012", reason))

print("=== POSTED ===", posted)
print("=== FAILED ===", failed)
