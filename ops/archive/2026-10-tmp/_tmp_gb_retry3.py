from di.integrations.reference_api import _get_token, _make_get_request, _row_value
from di.constants import REF_BASE_V2
from di.digital_invoicing.doctype.sale_tax_invoice.sale_tax_invoice import SaleTaxInvoice
import di.integrations.di_api as di_api
import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.di_api import _is_valid_response
from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice
from di.sandbox_drafts import format_fbr_validation_errors

frappe.set_user("Administrator")

SELLER = "Golden Ball International"
REG = "Sandbox Registered Buyer (Golden Ball International)"
RATE_FMT = {}
EXTRA_ITEM_FIELDS = {}

_orig_format = di_api._format_rate
_orig_build = sti_api._build_item_payload
_orig_calc = SaleTaxInvoice._calculate_totals


def _patched_format(percentage, sale_type):
	if sale_type in RATE_FMT:
		return RATE_FMT[sale_type]
	return _orig_format(percentage, sale_type)


def _patched_build(row):
	payload = _orig_build(row)
	payload.update(EXTRA_ITEM_FIELDS)
	return payload


def _patched_calc(self):
	_orig_calc(self)
	for row in self.get("invoice_items") or []:
		if row.sale_type != "Potassium Chlorate":
			continue
		value = float(row.value_sales_excluding_st or 0)
		qty = float(row.quantity or 0)
		tax = round(value * 0.18 + 60.0 * qty, 2)
		row.sales_tax_applicable = tax
		row.total_values = round(value + tax + float(row.extra_tax or 0) + float(row.further_tax or 0) + float(row.fed_payable or 0), 2)


di_api._format_rate = _patched_format
sti_api._format_rate = _patched_format
sti_api._build_item_payload = _patched_build
SaleTaxInvoice._calculate_totals = _patched_calc


def update_item(name, hs, uom, tax_desc, rate, fixed=0):
	doc = frappe.get_doc("Tax Item", name)
	doc.hs_code = hs
	doc.product_uom = uom
	doc.tax_desc = tax_desc
	doc.rate_in_p = rate
	doc.fixed_rs = fixed
	doc.save(ignore_permissions=True)
	frappe.db.commit()


def get_draft(sn, item, sale_rate, qty=1):
	names = frappe.get_all(
		"Sale Tax Invoice",
		filters={"seller__business_name": SELLER, "scenario_id": sn, "docstatus": 0},
		pluck="name",
		order_by="creation desc",
	)
	doc = frappe.get_doc("Sale Tax Invoice", names[0]) if names else None
	if not doc:
		from frappe.utils import nowdate
		doc = frappe.get_doc({
			"doctype": "Sale Tax Invoice",
			"invoice_type": "Sale Invoice",
			"invoice_date": nowdate(),
			"scenario_id": sn,
			"fbr_environment": "Sandbox",
			"buyer": REG,
			"seller__business_name": SELLER,
			"invoice_items": [{"description": item, "quantity": qty, "sale_rate": sale_rate}],
		})
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


posted, failed = [], []

# SN004 min price 151842
RATE_FMT.clear()
EXTRA_ITEM_FIELDS.clear()
update_item("SN004 Golden Ball International", "7204.1010", "MT", "18%", 18)
doc = get_draft("SN004", "SN004 Golden Ball International", 151842, 1)
doc = save_line(doc)
ok, reason = check(doc)
print("SN004 151842", "OK" if ok else reason)
if not ok:
	doc = get_draft("SN004", "SN004 Golden Ball International", 160000, 1)
	doc = save_line(doc)
	ok, reason = check(doc)
	print("SN004 160000", "OK" if ok else reason)
if ok:
	posted.append(("SN004", submit_ok(doc, "SN004")))
else:
	failed.append(("SN004", reason))

# SN022
RATE_FMT["Potassium Chlorate"] = "18% along with rupees 60 per kilogram"
update_item("SN022 Golden Ball International", "2829.1910", "KG", "18%", 18, 60)
for sale_rate in (1000, 100):
	doc = get_draft("SN022", "SN022 Golden Ball International", sale_rate, 1)
	doc = save_line(doc, "EIGHTH SCHEDULE Table 1", "56", extra=0, fixed=60)
	ok, reason = check(doc)
	print("SN022 rate", sale_rate, "OK" if ok else reason)
	if ok:
		posted.append(("SN022", submit_ok(doc, "SN022")))
		break
else:
	# try tax = 18% of (value+60)
	def _calc2(self):
		_orig_calc(self)
		for row in self.get("invoice_items") or []:
			if row.sale_type != "Potassium Chlorate":
				continue
			value = float(row.value_sales_excluding_st or 0)
			qty = float(row.quantity or 0)
			tax = round((value + 60.0 * qty) * 0.18, 2)
			row.sales_tax_applicable = tax
			row.total_values = round(value + tax, 2)
	SaleTaxInvoice._calculate_totals = _calc2
	doc = get_draft("SN022", "SN022 Golden Ball International", 1000, 1)
	doc = save_line(doc, "EIGHTH SCHEDULE Table 1", "56", extra=0, fixed=60)
	ok, reason = check(doc)
	print("SN022 tax-on-base+60", "OK" if ok else reason)
	if ok:
		posted.append(("SN022", submit_ok(doc, "SN022")))
	else:
		failed.append(("SN022", reason))

# SN012: levy works; need Liter UOM
print("=== HS 2710 liter ===")
token = _get_token(SELLER)
cands = frappe.db.sql(
	"select name from `tabHS Code` where name like '2710.%%' order by name limit 40"
)
liter_hits = []
for (code,) in cands:
	rows = _make_get_request("{}/HS_UOM".format(REF_BASE_V2), token, "uom", params={"hs_code": code, "annexure_id": 1}) or []
	uoms = [_row_value(i, "description") for i in rows]
	if any(u and "liter" in str(u).lower() or u in ("Liter", "Litre", "Ltr") for u in uoms):
		liter_hits.append((code, uoms))
		print(code, uoms)
if not liter_hits:
	print("no liter 2710 in first 40; sample", cands[:8])

EXTRA_ITEM_FIELDS.clear()
EXTRA_ITEM_FIELDS["petroleumLevyOn"] = 1
hs_try = liter_hits[:6] if liter_hits else [("2710.1911", ["Liter"]), ("2710.1210", ["Liter"]), ("2710.1911", ["KG"])]
found = False
for code, uoms in hs_try:
	uom = "Liter" if any(str(u) == "Liter" for u in uoms) else (uoms[0] if uoms else "Liter")
	update_item("SN012 Golden Ball International", code, uom, "18%", 18)
	doc = get_draft("SN012", "SN012 Golden Ball International", 1000, 1)
	doc = save_line(doc)
	ok, reason = check(doc)
	print("SN012", code, uom, "OK" if ok else reason)
	if ok:
		posted.append(("SN012", submit_ok(doc, "SN012")))
		found = True
		break
if not found:
	failed.append(("SN012", reason))

print("=== POSTED ===", posted)
print("=== FAILED ===", failed)
