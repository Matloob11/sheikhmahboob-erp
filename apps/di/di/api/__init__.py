from inspect import signature

import frappe
from frappe import _
from frappe.utils import cstr


@frappe.whitelist()
def resync_invoice(doctype, name):
	"""Re-post an invoice to FBR DI after corrections."""
	from di.integrations.di_api import post_invoice

	doc = frappe.get_doc(doctype, name)
	post_invoice(doc, resync=True)
	return {"success": True, "message": _("Invoice re-synced successfully")}


@frappe.whitelist()
def validate_invoice(doctype, name):
	"""Validate invoice with FBR without posting."""
	from di.integrations.di_api import validate_invoice as _validate

	doc = frappe.get_doc(doctype, name)
	return _validate(doc)


@frappe.whitelist()
def get_invoice_preview(doctype, name):
	"""Preview the DI payload without posting."""
	doc = frappe.get_doc(doctype, name)
	if doctype == "Sale Tax Invoice":
		from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

		return build_sale_tax_invoice_payload(doc)

	from di.integrations.di_api import build_di_payload

	return build_di_payload(doc)


@frappe.whitelist()
def post_sale_tax_invoice(name):
	"""Post a submitted standalone Sale Tax Invoice to FBR."""
	from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice as _post

	doc = frappe.get_doc("Sale Tax Invoice", name)
	_post(doc, resync=True)
	return {"success": True, "message": _("Sale Tax Invoice posted to FBR successfully")}


@frappe.whitelist()
def validate_sale_tax_invoice(name):
	"""Validate standalone Sale Tax Invoice with FBR without posting."""
	from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice as _validate

	doc = frappe.get_doc("Sale Tax Invoice", name)
	return _validate(doc)


@frappe.whitelist()
def verify_buyer(customer):
	"""Check buyer registration status via STATL."""
	from di.integrations.statl import get_registration_type

	ntn_cnic = frappe.db.get_value("Customer", customer, "ntn_cnic")
	if not ntn_cnic:
		frappe.throw(_("Customer {0} does not have NTN/CNIC set").format(customer))
	return get_registration_type(ntn_cnic)


@frappe.whitelist()
def sync_reference_data(data_type, **kwargs):
	"""Trigger reference data sync from FBR in the background."""
	from di.integrations import reference_api

	sync_map = {
		"all_reference_data": reference_api.sync_all_reference_data,
		"provinces": reference_api.sync_provinces,
		"hs_codes": reference_api.sync_hs_codes,
		"hs_code_uoms": reference_api.sync_hs_code_uoms,
		"uoms": reference_api.sync_uoms,
		"transaction_types": reference_api.sync_transaction_types,
		"sro_item_codes": reference_api.sync_sro_item_codes,
		"sro_schedules": reference_api.sync_sro_schedules,
		"sro_schedules_for_rates": reference_api.sync_sro_schedules_for_rates,
	}

	func = sync_map.get(data_type)
	if not func:
		frappe.throw(_("Unknown data type: {0}").format(data_type))

	supported_params = signature(func).parameters
	filtered_kwargs = {key: value for key, value in kwargs.items() if key in supported_params}

	frappe.enqueue(
		func,
		queue="default",
		job_id=f"sync_reference_data_{data_type}",
		deduplicate=True,
		**filtered_kwargs,
	)

	frappe.msgprint(
		_("Syncing {0} in background. You will be notified on completion.").format(data_type),
		alert=True,
	)


@frappe.whitelist()
def import_seed_hs_codes():
	"""Import bundled HS codes from di/data/hs_codes.json."""
	from di.seed_data import seed_hs_codes

	# Explicit user action: always do the work, even if the bundled file is
	# unchanged since the last seed.
	result = seed_hs_codes(force=True)
	frappe.db.commit()
	return result


@frappe.whitelist()
def import_seed_hs_uoms():
	"""Replace HS UOM master rows with the bundled DI UOM list."""
	from di.seed_data import seed_hs_uoms

	result = seed_hs_uoms()
	frappe.db.commit()
	return result


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def search_hs_uoms(
	doctype,
	txt,
	searchfield,
	start,
	page_len,
	filters,
	as_dict=False,
	reference_doctype=None,
	ignore_user_permissions=False,
	link_fieldname=None,
):
	"""Search HS UOMs with prefix matches first and curated-list order preserved."""
	txt = cstr(txt).strip()
	return frappe.db.sql(
		"""
		select name, uom_name
		from `tabHS Uom`
		where %(txt)s = ''
			or name like %(contains)s
			or uom_name like %(contains)s
		order by
			case
				when %(txt)s = '' then 0
				when lower(name) like %(prefix)s or lower(uom_name) like %(prefix)s then 0
				else 1
			end,
			idx asc,
			name asc
		limit %(page_len)s offset %(start)s
		""",
		{
			"txt": txt,
			"contains": f"%{txt}%",
			"prefix": f"{txt.lower()}%",
			"start": start,
			"page_len": page_len,
		},
		as_dict=as_dict,
	)


@frappe.whitelist()
def get_setup_status(company=None):
	"""Check every prerequisite for posting to FBR and say what is missing.

	Setting this up means getting eight unrelated things right, most of which
	fail late and quietly — a missing Tax Type reports 0% tax, a missing HS UOM
	is rejected as error 0099, a buyer sharing the seller's NTN is 0058. This
	reports all of them up front.
	"""
	company = company or frappe.defaults.get_global_default("company")
	checks = []

	def add(label, ok, hint=""):
		checks.append({"label": label, "ok": bool(ok), "hint": "" if ok else hint})

	settings_name = frappe.db.get_value("DI Settings", {"company": company}, "name")
	add(
		_("DI Settings exist for {0}").format(company or "?"),
		settings_name,
		_("Create a DI Settings record for this company."),
	)
	if not settings_name:
		return {"company": company, "checks": checks}

	settings = frappe.get_doc("DI Settings", settings_name)
	add(_("Digital Invoicing enabled"), settings.enabled, _("Tick Enable Digital Invoicing."))
	add(
		_("FBR access token set ({0})").format(settings.sync_mode),
		settings.get_password("access_token", raise_exception=False),
		_("Paste the FBR token for the {0} environment.").format(settings.sync_mode),
	)
	add(_("Seller NTN/CNIC set"), settings.ntn_cnic, _("Fill NTN/CNIC in DI Settings."))
	add(_("Seller province set"), settings.province, _("Fill Province in DI Settings."))
	add(_("Seller address set"), settings.address, _("Fill Address in DI Settings."))
	add(
		_("Sale types configured"),
		len(settings.get("sale_types") or []),
		_("Add the sale types you use to the Sale Types table, otherwise Items cannot pick one."),
	)

	typed = frappe.db.count("Sales Taxes and Charges", {"di_tax_type": ["is", "set"]})
	add(
		_("Tax templates carry a Tax Type"),
		typed,
		_("Set Tax Type on your Sales Taxes and Charges rows, or FBR is told the tax is zero."),
	)

	items = frappe.db.count("Item", {"disabled": 0})
	with_hs = frappe.db.count("Item", {"disabled": 0, "hs_code": ["is", "set"]})
	if not items:
		add(_("Items created"), False, _("No items exist yet. Create the items you sell."))
	else:
		add(
			_("Items have an HS Code ({0} of {1})").format(with_hs, items),
			with_hs == items,
			_("Set HS Code on every item you sell; FBR rejects a line without one."),
		)

	customers = frappe.db.count("Customer", {"enable_digital_invoicing": 1})
	add(
		_("Customers marked for Digital Invoicing"),
		customers,
		_("Tick Enable Digital Invoicing on the customers you report."),
	)

	clash = frappe.db.count("Customer", {"ntn_cnic": settings.ntn_cnic}) if settings.ntn_cnic else 0
	add(
		_("No customer shares the seller's NTN"),
		not clash,
		_("FBR refuses self invoicing (error 0058). Give those customers their own NTN."),
	)

	return {"company": company, "checks": checks}


@frappe.whitelist()
def get_qr_code(integration_id):
	"""Generate FBR QR code at runtime for a given integration ID."""
	from di.integrations.qr_code import generate_qr_code

	if not integration_id:
		return ""
	return generate_qr_code(integration_id)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_sale_types_for_company(doctype, txt, searchfield, start, page_len, filters):
	"""Query filter for sale type dropdown - returns only company-configured types."""
	company = filters.get("company")
	if not company:
		return []

	return frappe.db.sql(
		"""
		SELECT cst.sale_type
		FROM `tabCompany Sale Type` cst
		WHERE cst.parent = %(company)s
			AND cst.parenttype = 'DI Settings'
			AND cst.sale_type LIKE %(txt)s
		ORDER BY cst.sale_type
		LIMIT %(page_len)s OFFSET %(start)s
		""",
		{
			"company": company,
			"txt": f"%{txt}%",
			"start": start,
			"page_len": page_len,
		},
	)
