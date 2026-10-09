from inspect import signature

import frappe
from frappe import _
from frappe.utils import cstr

_SUPPORTED_INVOICE_DOCTYPES = ("Sales Invoice", "Purchase Invoice", "Sale Tax Invoice")


def _require_invoice_doctype(doctype):
	if doctype not in _SUPPORTED_INVOICE_DOCTYPES:
		frappe.throw(_("Unsupported document type"))


def _require_doc_permission(doctype, name, ptype):
	doc = frappe.get_doc(doctype, name)
	frappe.has_permission(doctype, ptype, doc=doc, throw=True)
	return doc


@frappe.whitelist()
def resync_invoice(doctype, name):
	"""Re-post an invoice to FBR DI after corrections.

	A second post of a numbered invoice is a second filing. Clear the number
	first with ``clear_fbr_invoice_no`` (System Manager, guarded) when that is
	genuinely required.
	"""
	from di.integrations.di_api import post_invoice

	_require_invoice_doctype(doctype)
	doc = _require_doc_permission(doctype, name, "submit")
	if doctype == "Sale Tax Invoice":
		if cstr(doc.get("fbr_invoice_no") or "").strip():
			frappe.throw(
				_(
					"Invoice {0} already has FBR number {1}. Clear it first if a Sandbox re-file is required."
				).format(name, doc.fbr_invoice_no)
			)
		from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice as _post

		# resync=True is persistence (db_set), not an override — the FBR number
		# was already confirmed blank above, so this cannot refile a numbered
		# invoice; it only makes sure the new number is saved on this
		# already-submitted doc instead of being set in memory and lost.
		_post(doc, resync=True)
	else:
		if doc.get("di_integration_id") or doc.get("is_di_posted"):
			frappe.throw(
				_(
					"Invoice {0} is already posted to FBR ({1}). Clear the DI integration id before re-filing."
				).format(name, doc.get("di_integration_id") or _("posted"))
			)
		post_invoice(doc, resync=True)
	return {"success": True, "message": _("Invoice re-synced successfully")}


@frappe.whitelist()
def validate_invoice(doctype, name):
	"""Validate invoice with FBR without posting."""
	from di.integrations.di_api import validate_invoice as _validate

	_require_invoice_doctype(doctype)
	doc = _require_doc_permission(doctype, name, "write")
	if doctype == "Sale Tax Invoice":
		from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice as _sti

		return _sti(doc)
	return _validate(doc)


@frappe.whitelist()
def get_invoice_preview(doctype, name):
	"""Preview the DI payload without posting."""
	_require_invoice_doctype(doctype)
	doc = _require_doc_permission(doctype, name, "read")
	if doctype == "Sale Tax Invoice":
		from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

		return build_sale_tax_invoice_payload(doc)

	from di.integrations.di_api import build_di_payload

	return build_di_payload(doc)


@frappe.whitelist()
def get_sale_invoice_company_cards():
	"""Sellers plus sandbox/production invoice counts for the Sale Invoices picker."""
	from di.invoice_picker import get_sale_invoice_company_cards as _cards

	return _cards()


@frappe.whitelist()
def post_sale_tax_invoice(name):
	"""Post a submitted standalone Sale Tax Invoice to FBR.

	Refuses a second filing when ``fbr_invoice_no`` is already set. There is no
	force flag — FBR has no void and no deduplication.
	"""
	from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice as _post

	doc = _require_doc_permission("Sale Tax Invoice", name, "submit")
	if cint_docstatus(doc) != 1:
		frappe.throw(_("Sale Tax Invoice {0} must be submitted before posting to FBR.").format(name))
	if cstr(doc.get("fbr_invoice_no") or "").strip():
		frappe.throw(
			_("Sale Tax Invoice {0} already has FBR number {1}; a second post would file again.").format(
				name, doc.fbr_invoice_no
			)
		)
	# resync=True here is persistence, not permission: the duplicate-filing check
	# just ran above, so this only tells _apply_success to db_set the number
	# instead of setting it in memory — this doc is already submitted, there is
	# no enclosing save() to carry an in-memory assignment to the database.
	_post(doc, resync=True)
	return {"success": True, "message": _("Sale Tax Invoice posted to FBR successfully")}


def cint_docstatus(doc):
	from frappe.utils import cint

	return cint(doc.get("docstatus"))


@frappe.whitelist()
def clear_fbr_invoice_no(name, reason):
	"""Blank a Sale Tax Invoice FBR number (System Manager only).

	Allowed only in Sandbox, or when no successful DI Post log exists for that
	document and number. Production invoices with a Post Success row are frozen.
	"""
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("Only System Manager can clear an FBR invoice number."), frappe.PermissionError)

	reason = cstr(reason or "").strip()
	if not reason:
		frappe.throw(_("A reason is required to clear an FBR invoice number."))

	doc = frappe.get_doc("Sale Tax Invoice", name)
	frappe.has_permission("Sale Tax Invoice", "write", doc=doc, throw=True)

	number = cstr(doc.get("fbr_invoice_no") or "").strip()
	if not number:
		frappe.throw(_("Sale Tax Invoice {0} has no FBR invoice number to clear.").format(name))

	env = cstr(doc.get("fbr_environment") or "").strip()
	has_success = frappe.db.exists(
		"DI Log",
		{
			"document_type": "Sale Tax Invoice",
			"document_name": name,
			"api_type": "DI Post",
			"status": "Success",
			"fbr_invoice_number": number,
		},
	)
	if env != "Sandbox" and has_success:
		frappe.throw(
			_(
				"Cannot clear FBR number {0}: a successful DI Post log exists for Production invoice {1}."
			).format(number, name)
		)

	doc.db_set("fbr_invoice_no", "", update_modified=False)
	doc.db_set("qr_code_data", "", update_modified=False)
	if doc.meta.has_field("fbr_payload_hash"):
		doc.db_set("fbr_payload_hash", "", update_modified=False)
	from di.digital_invoicing.doctype.di_log.di_log import create_log

	create_log(
		"Sale Tax Invoice",
		name,
		{"cleared_number": number, "reason": reason},
		{},
		status="Success",
		api_type="DI Post",
		title=f"FBR number cleared: {reason[:80]}",
		error_message=reason,
	)
	frappe.db.commit()
	return {"success": True, "cleared": number}


@frappe.whitelist()
def validate_sale_tax_invoice(name):
	"""Validate standalone Sale Tax Invoice with FBR without posting."""
	from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice as _validate

	doc = _require_doc_permission("Sale Tax Invoice", name, "write")
	return _validate(doc)


@frappe.whitelist()
def verify_buyer(customer):
	"""Check buyer registration status via STATL."""
	from di.integrations.statl import get_registration_type

	frappe.has_permission("Customer", "read", doc=customer, throw=True)
	ntn_cnic = frappe.db.get_value("Customer", customer, "ntn_cnic")
	if not ntn_cnic:
		frappe.throw(_("Customer {0} does not have NTN/CNIC set").format(customer))
	return get_registration_type(ntn_cnic)


@frappe.whitelist()
def sync_reference_data(data_type, **kwargs):
	"""Trigger reference data sync from FBR in the background."""
	from di.integrations import reference_api
	from di.integrations.reference_api import _guard_reference_access

	_guard_reference_access()

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

	# Wrapped so the promise below is actually kept: the wrapper reports the
	# outcome, success or failure, back to whoever pressed the button. The bare
	# enqueue used to fail silently into an Error Log nobody reads.
	frappe.enqueue(
		"di.tasks.run_reference_sync",
		queue="default",
		job_id=f"sync_reference_data_{data_type}",
		deduplicate=True,
		dotted_path=f"{func.__module__}.{func.__name__}",
		label=data_type,
		user=frappe.session.user,
		**filtered_kwargs,
	)

	frappe.msgprint(
		_("Syncing {0} in background. You will be notified on completion.").format(data_type),
		alert=True,
	)


@frappe.whitelist()
def import_seed_hs_codes():
	"""Import bundled HS codes from di/data/hs_codes.json."""
	from di.integrations.reference_api import _guard_reference_access
	from di.seed_data import seed_hs_codes

	_guard_reference_access(writes=("HS Code",))
	# Explicit user action: always do the work, even if the bundled file is
	# unchanged since the last seed.
	result = seed_hs_codes(force=True)
	frappe.db.commit()
	return result


@frappe.whitelist()
def import_seed_hs_uoms():
	"""Replace HS UOM master rows with the bundled DI UOM list."""
	from di.integrations.reference_api import _guard_reference_access
	from di.seed_data import seed_hs_uoms

	_guard_reference_access(writes=("HS Uom",))
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

	Setting this up means getting eleven unrelated things right, most of which
	fail late and quietly — a missing Tax Type reports 0% tax, a missing HS UOM
	is rejected as error 0099, a buyer sharing the seller's NTN is 0058. This
	reports all of them up front.
	"""
	# The result describes the company's tax configuration: whether a token is
	# held, the seller's registration state, customer counts. Nobody who cannot
	# read DI Settings should be able to ask for it.
	frappe.has_permission("DI Settings", "read", throw=True)

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
def get_sandbox_pending_scenarios(company=None):
	"""Inspect the DI Settings token and list sandbox scenarios still to submit."""
	frappe.has_permission("DI Settings", "write", throw=True)
	from di.sandbox_drafts import list_sandbox_scenarios

	company = company or frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("Company is required."))
	return list_sandbox_scenarios(company)


@frappe.whitelist()
def create_sandbox_scenario_drafts(company=None, scenario_ids=None):
	"""Validate and submit Sale Tax Invoices for the selected sandbox scenarios."""
	frappe.has_permission("DI Settings", "write", throw=True)
	from di.sandbox_drafts import create_sandbox_drafts

	company = company or frappe.defaults.get_global_default("company")
	if isinstance(scenario_ids, str):
		scenario_ids = frappe.parse_json(scenario_ids)
	return create_sandbox_drafts(company, scenario_ids or [])


@frappe.whitelist()
def load_fbr_sale_types(company=None, save=1):
	"""Fill DI Settings sale types from the official FBR list."""
	from di.digital_invoicing.doctype.di_settings.di_settings import load_fbr_sale_types as _load

	return _load(company=company, save=save)


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
