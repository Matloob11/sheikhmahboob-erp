"""FBR STATL (Sales Tax Active Taxpayer List) verification.

Verifies buyer/seller registration status with FBR.
"""

import frappe
from frappe import _
from frappe.utils import cstr, today

from di.constants import STATL_BASE_URL
from di.digital_invoicing.doctype.di_log.di_log import create_log
from di.integrations.http import FBRError
from di.integrations.http import post as fbr_post


def _fetch_registration_type(registration_no, token, log_doctype, log_name):
	"""Call Get_Reg_Type with an explicit bearer token (no DI Settings lookup)."""
	if not registration_no:
		frappe.throw(_("Registration number is required"))
	if not token:
		frappe.throw(_("FBR token is required for registration lookup."))

	url = f"{STATL_BASE_URL}/Get_Reg_Type"
	payload = {"registrationNo": cstr(registration_no).strip()}

	try:
		result = fbr_post(url, token, payload, "STATL registration type")
	except FBRError as e:
		create_log(
			log_doctype,
			log_name,
			payload,
			str(e),
			status="Error",
			api_type="STATL",
			title=f"STATL Reg Type Error: {registration_no}",
		)
		raise

	create_log(
		log_doctype,
		log_name,
		payload,
		result,
		status="Success",
		api_type="STATL",
		title=f"STATL Reg Type: {registration_no}",
	)
	return result


@frappe.whitelist()
def check_status(registration_no, date=None, company=None):
	"""Check registration status via STATL API."""
	from di.integrations.reference_api import _guard_reference_access

	_guard_reference_access()
	if not registration_no:
		frappe.throw(_("Registration number is required"))

	token = _get_token(company)
	url = f"{STATL_BASE_URL}/statl"
	payload = {
		"registrationNo": cstr(registration_no).strip(),
		"date": cstr(date or today()),
	}

	try:
		result = fbr_post(url, token, payload, "STATL check")
	except FBRError as e:
		create_log(
			"Customer",
			"",
			payload,
			str(e),
			status="Error",
			api_type="STATL",
			title=f"STATL Error: {registration_no}",
		)
		raise

	create_log(
		"Customer",
		"",
		payload,
		result,
		status="Success",
		api_type="STATL",
		title=f"STATL Check: {registration_no}",
	)

	return result


@frappe.whitelist()
def get_registration_type(registration_no, company=None):
	"""Get buyer registration type (Registered/Unregistered) from FBR."""
	from di.integrations.reference_api import _guard_reference_access

	_guard_reference_access()
	token = _get_token(company)
	return _fetch_registration_type(registration_no, token, "Customer", "")


def _get_token(company=None):
	"""Get bearer token from DI Settings."""
	from di.digital_invoicing.doctype.di_settings.di_settings import get_settings

	if not company:
		company = frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("No company specified for STATL verification"))

	settings = get_settings(company)
	if not settings:
		frappe.throw(_("DI Settings not found for company {0}").format(company))

	return settings.get_password("access_token")


def normalise_registration_type(result) -> str:
	"""Map a STATL Get_Reg_Type body to Registered / Unregistered / blank."""
	if not isinstance(result, dict):
		return ""
	raw = cstr(
		result.get("registrationType")
		or result.get("REGISTRATIONTYPE")
		or result.get("status")
		or result.get("Status")
		or ""
	).strip()
	# Collapse hyphens/spaces so "Un-Registered" still matches before "Registered".
	compact = "".join(ch for ch in raw.lower() if ch.isalnum())
	if "unreg" in compact:
		return "Unregistered"
	if "reg" in compact:
		return "Registered"
	return raw


def registration_mismatch(stored_type, fbr_type) -> bool:
	stored = cstr(stored_type or "").strip()
	fbr = cstr(fbr_type or "").strip()
	if not stored or not fbr:
		return False
	return stored.lower() != fbr.lower()
