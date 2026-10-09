"""Submit remaining Golden Ball sandbox scenarios. Commit after each success."""

from __future__ import annotations

import di.integrations.di_api as di_api
import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.di_api import _is_valid_response
from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice
from frappe.utils import nowdate

frappe.set_user("Administrator")

SELLER = "Golden Ball International"
REG = "Sandbox Registered Buyer (Golden Ball International)"
UNREG = "Walk-in Buyer (Unregistered)"
RATE_FMT = {}

_orig_format = di_api._format_rate


def _patched_format(percentage, sale_type):
	if sale_type in RATE_FMT:
		return RATE_FMT[sale_type]
	return _orig_format(percentage, sale_type)


di_api._format_rate = _patched_format
sti_api._format_rate = _patched_format

# Each attempt: item, hs, uom, tax_desc, rate, rate_id, extra, fixed, sale_rate, qty, sro, serial
ATTEMPTS = {
	"SN004": [
		dict(item="SN004 Golden Ball International", hs="8908.0000", uom="Numbers, pieces, units", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN004 Golden Ball International", hs="7204.4990", uom="KG", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
	],
	"SN010": [
		dict(item="SN010 Golden Ball International", hs="9803.0000", uom="Numbers, pieces, units", tax_desc="17%", rate=17, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN010 Golden Ball International", hs="9803.1000", uom="Numbers, pieces, units", tax_desc="17%", rate=17, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN010 Golden Ball International", hs="9801.5000", uom="Numbers, pieces, units", tax_desc="17%", rate=17, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN010 Golden Ball International", hs="9803.0000", uom="Numbers, pieces, units", tax_desc="18.5%", rate=18.5, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
	],
	"SN012": [
		dict(item="SN012 Golden Ball International", hs="2710.1911", uom="KG", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN012 Golden Ball International", hs="2710.1992", uom="KG", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN012 Golden Ball International", hs="2710.1911", uom="KG", tax_desc="0%", rate=0, extra=0, fixed=0, sale_rate=1000, qty=1, sro="1579(1)/2021", serial="1"),
	],
	"SN013": [
		dict(item="SN013 Golden Ball International", hs="2716.0000", uom="KWH", tax_desc="5%", rate=5, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
		dict(item="SN013 Golden Ball International", hs="2716.0000", uom="KWH", tax_desc="7.5%", rate=7.5, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
	],
	"SN015": [
		dict(item="SN015 Golden Ball International", hs="8517.1310", uom="Numbers, pieces, units", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="NINTH SCHEDULE", serial="1(A)"),
		dict(item="SN015 Golden Ball International", hs="8517.1390", uom="Numbers, pieces, units", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="NINTH SCHEDULE", serial="1(B)"),
		dict(item="SN015 Golden Ball International", hs="8517.1100", uom="Numbers, pieces, units", tax_desc="25%", rate=25, extra=0, fixed=0, sale_rate=1000, qty=1, sro="NINTH SCHEDULE", serial="1(B)"),
	],
	"SN020": [
		dict(item="SN020 Golden Ball International", hs="8703.8090", uom="Numbers, pieces, units", tax_desc="1%", rate=1, extra=0, fixed=0, sale_rate=1000, qty=1, sro="6th Schd Table III", serial="20"),
		dict(item="SN020 Golden Ball International", hs="8703.8090", uom="Numbers, pieces, units", tax_desc="1%", rate=1, extra=0, fixed=0, sale_rate=1000, qty=1, sro="EIGHTH SCHEDULE Table 1", serial="20"),
		dict(item="SN020 Golden Ball International", hs="8703.8030", uom="Numbers, pieces, units", tax_desc="1%", rate=1, extra=0, fixed=0, sale_rate=1000, qty=1, sro="6th Schd Table III", serial="22"),
	],
	"SN021": [
		dict(item="SN021 Golden Ball International", hs="2523.2900", uom="KG", tax_desc="Rs.2", rate=2, extra=0, fixed=0, sale_rate=100, qty=1, sro="", serial="", rate_fmt="Rs.2"),
		dict(item="SN021 Golden Ball International", hs="2523.1000", uom="KG", tax_desc="Rs.3", rate=3, extra=0, fixed=0, sale_rate=100, qty=1, sro="", serial="", rate_fmt="Rs.3"),
	],
	"SN022": [
		dict(item="SN022 Golden Ball International", hs="2829.1910", uom="KG", tax_desc="18%", rate=18, extra=60, fixed=0, sale_rate=1000, qty=1, sro="EIGHTH SCHEDULE Table 1", serial="56"),
	],
	"SN023": [
		dict(item="SN023 Golden Ball International", hs="2711.2100", uom="KG", tax_desc="Rs.200", rate=200, extra=0, fixed=0, sale_rate=100, qty=1, sro="", serial="", rate_fmt="Rs.200"),
		dict(item="SN023 Golden Ball International", hs="2711.2100", uom="MMBTU", tax_desc="Rs.200", rate=200, extra=0, fixed=0, sale_rate=100, qty=1, sro="", serial="", rate_fmt="Rs.200"),
	],
	"SN026": [
		dict(item="SN001 Golden Ball International", hs="4820.9000", uom="Numbers, pieces, units", tax_desc="18%", rate=18, extra=0, fixed=0, sale_rate=1000, qty=1, sro="", serial=""),
	],
	"SN027": [
		dict(item="SN008 Golden Ball International", hs="4820.9000", uom="Numbers, pieces, units", tax_desc="18%", rate=18, extra=0, fixed=1000, sale_rate=1000, qty=1, sro="", serial=""),
	],
	"SN028": [
		dict(item="SN005 Golden Ball International", hs="4820.9000", uom="Numbers, pieces, units", tax_desc="1%", rate=1, extra=0, fixed=0, sale_rate=1000, qty=1, sro="EIGHTH SCHEDULE Table 1", serial="70"),
	],
}

UNREG_SNS = {"SN026", "SN027", "SN028"}
REUSE = {"SN004": "STI-0067"}


def ensure_item(cfg):
	name = cfg["item"]
	doc = frappe.get_doc("Tax Item", name)
	doc.hs_code = cfg["hs"]
	doc.product_uom = cfg["uom"]
	doc.tax_desc = cfg["tax_desc"]
	doc.rate_in_p = cfg["rate"]
	doc.fixed_rs = cfg["fixed"]
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	return name


def get_draft(sn):
	reuse = REUSE.get(sn)
	if reuse and frappe.db.exists("Sale Tax Invoice", reuse):
		doc = frappe.get_doc("Sale Tax Invoice", reuse)
		if int(doc.docstatus) == 0:
			return doc
	names = frappe.get_all(
		"Sale Tax Invoice",
		filters={"seller__business_name": SELLER, "scenario_id": sn, "docstatus": 0},
		pluck="name",
		order_by="creation desc",
	)
	if names:
		return frappe.get_doc("Sale Tax Invoice", names[0])
	buyer = UNREG if sn in UNREG_SNS else REG
	doc = frappe.get_doc(
		{
			"doctype": "Sale Tax Invoice",
			"invoice_type": "Sale Invoice",
			"invoice_date": nowdate(),
			"scenario_id": sn,
			"fbr_environment": "Sandbox",
			"buyer": buyer,
			"seller__business_name": SELLER,
			"sandbox_run_status": "Pending Review",
			"invoice_items": [
				{
					"description": ATTEMPTS[sn][0]["item"],
					"quantity": 1,
					"sale_rate": 1000,
				}
			],
		}
	)
	doc.insert(ignore_permissions=True)
	frappe.db.commit()
	return doc


def apply_attempt(doc, cfg):
	RATE_FMT.clear()
	if cfg.get("rate_fmt"):
		for row in doc.get("invoice_items") or []:
			# sale type applied on validate
			pass
		# set after we know sale type; also set both cement/cng keys
		RATE_FMT["Cement /Concrete Block"] = cfg["rate_fmt"] if "Rs." in cfg["rate_fmt"] and cfg["rate"] < 50 else RATE_FMT.get("Cement /Concrete Block", "")
		RATE_FMT["CNG Sales"] = cfg["rate_fmt"] if cfg["rate"] >= 50 else RATE_FMT.get("CNG Sales", "")
		if cfg["rate_fmt"].startswith("Rs."):
			if cfg["rate"] >= 50:
				RATE_FMT["CNG Sales"] = cfg["rate_fmt"]
			else:
				RATE_FMT["Cement /Concrete Block"] = cfg["rate_fmt"]

	item = ensure_item(cfg)
	doc.reload()
	if not doc.invoice_items:
		doc.append("invoice_items", {})
	row = doc.invoice_items[0]
	row.description = item
	row.quantity = cfg["qty"]
	row.sale_rate = cfg["sale_rate"]
	row.sro_schedule_no = cfg["sro"]
	row.sro_item_serial_no = cfg["serial"]
	row.extra_tax = cfg["extra"]
	row.fixed_notified_value_or_retail_price = cfg["fixed"]
	doc.fbr_environment = "Sandbox"
	doc.save(ignore_permissions=True)
	frappe.db.commit()
	doc.reload()
	return doc


def validate_doc(doc):
	try:
		response = validate_sale_tax_invoice(doc)
	except Exception as exc:
		return False, str(exc)[:350]
	if _is_valid_response(response):
		return True, ""
	from di.sandbox_drafts import format_fbr_validation_errors

	return False, format_fbr_validation_errors(response)[:350]


posted = []
failed = []

for sn, attempts in ATTEMPTS.items():
	already = frappe.db.get_value(
		"Sale Tax Invoice",
		{"seller__business_name": SELLER, "scenario_id": sn, "docstatus": 1, "fbr_invoice_no": ["!=", ""]},
		["name", "fbr_invoice_no"],
		as_dict=True,
	)
	if already:
		print("SKIP already", sn, already.name, already.fbr_invoice_no)
		posted.append((sn, already.name, already.fbr_invoice_no, "already"))
		continue

	doc = get_draft(sn)
	last_reason = ""
	ok = False
	for i, cfg in enumerate(attempts, start=1):
		try:
			doc = apply_attempt(doc, cfg)
			valid, reason = validate_doc(doc)
			print("TRY", sn, doc.name, i, cfg["hs"], cfg["uom"], cfg["tax_desc"], cfg["sro"], cfg["serial"], "OK" if valid else reason)
			if not valid:
				last_reason = reason
				continue
			doc.reload()
			doc.submit()
			frappe.db.commit()
			doc.reload()
			print("POSTED", sn, doc.name, doc.fbr_invoice_no)
			posted.append((sn, doc.name, doc.fbr_invoice_no, "new"))
			ok = True
			break
		except Exception as exc:
			frappe.db.rollback()
			last_reason = str(exc)[:350]
			print("ERR", sn, i, last_reason)
			try:
				doc = get_draft(sn)
			except Exception:
				pass
	if not ok:
		failed.append((sn, last_reason))

print("=== POSTED ===")
for row in posted:
	print(row)
print("=== FAILED ===")
for row in failed:
	print(row)
