"""Resolve FBR bearer credentials for a Seller Or Company (panel-safe)."""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cstr

from di.constants import DEFAULT_ANNEXURE_ID


def seller_fbr_context(seller, environment=None):
	"""Return ``(token, province_code, annexure_id)`` for one seller.

	Permission is checked with ``doc=`` so panel hooks confine callers to their
	assigned sellers. Token choice: explicit ``environment``, else the DI Settings
	``sync_mode`` for a row whose company equals the seller, else production,
	else sandbox.
	"""
	seller_name = cstr(seller or "").strip()
	if not seller_name:
		frappe.throw(_("Seller is required for FBR credential lookup."))

	if not frappe.db.exists("Seller Or Company", seller_name):
		frappe.throw(_("Seller Or Company {0} not found.").format(seller_name))

	seller_doc = frappe.get_doc("Seller Or Company", seller_name)
	frappe.has_permission("Seller Or Company", "read", doc=seller_doc, throw=True)

	env = cstr(environment or "").strip()
	if not env:
		settings_mode = frappe.db.get_value("DI Settings", {"company": seller_name}, "sync_mode")
		env = cstr(settings_mode or "").strip()
	if env not in ("Sandbox", "Production"):
		env = ""

	token = ""
	missing_field = ""
	if env == "Sandbox":
		token = cstr(seller_doc.get_password("sandbox_token", raise_exception=False) or "").strip()
		missing_field = "sandbox_token"
	elif env == "Production":
		token = cstr(seller_doc.get_password("production_token", raise_exception=False) or "").strip()
		missing_field = "production_token"
	else:
		token = cstr(seller_doc.get_password("production_token", raise_exception=False) or "").strip()
		missing_field = "production_token"
		if not token:
			token = cstr(seller_doc.get_password("sandbox_token", raise_exception=False) or "").strip()
			missing_field = "sandbox_token"

	if not token:
		frappe.throw(
			_("{0} is missing on Seller Or Company {1}.").format(
				missing_field.replace("_", " ").title(), seller_name
			)
		)

	province_name = cstr(seller_doc.get("seller_province") or "").strip()
	province_code = None
	if province_name:
		province_code = frappe.db.get_value("Province", province_name, "province_code")
	if province_code in (None, ""):
		# Province name may already be the select option matching Province.name
		province_code = frappe.db.get_value("Province", {"province_name": province_name}, "province_code")
	if province_code in (None, ""):
		frappe.throw(_("Seller province code is missing for {0}.").format(seller_name))

	annexure_id = frappe.db.get_value("DI Settings", {"company": seller_name}, "annexure_id")
	return token, cint_province(province_code), annexure_id or DEFAULT_ANNEXURE_ID


def cint_province(value):
	"""Province codes are numeric strings; keep them as ints for FBR query params."""
	from frappe.utils import cint

	return cint(value)


def resolve_seller_arg(seller=None, company=None):
	"""Prefer ``seller``; fall back to deprecated ``company`` alias; then sole allowed seller."""
	from di.panel import get_allowed_sellers, is_panel_user

	name = cstr(seller or company or "").strip()
	if name:
		return name
	if is_panel_user():
		allowed = get_allowed_sellers()
		if len(allowed) == 1:
			return allowed[0]
	return None
