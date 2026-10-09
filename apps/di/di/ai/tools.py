"""The tools the model may call, each run as the logged-in user.

Every tool starts by checking that the seller it touches is one the user is
allowed (System Manager: all; DI Panel User: the Client Panel assignment).
That check is the one thing the DocType permissions do not give us: the
has_permission hook in di.panel answers True for "create" on any seller, so a
draft inserted for another seller would pass the framework. Reads go through
frappe.get_list so the seller-scoping query conditions apply; writes commit at
once so what the model has been told exists cannot be rolled back by a later
failure in the same request. FBR lookups use the seller's own token through
di.integrations.http directly, never the DI-Settings-guarded reference helpers.

A ToolError is a sentence for the model. Anything else is a bug and is logged.
"""

from __future__ import annotations

import json
import re
import time

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, getdate, now_datetime, nowdate

from di.ai import hs_search, rules
from di.constants import DEFAULT_ANNEXURE_ID, PRODUCT_UOM_OPTIONS, REF_BASE_V1, REF_BASE_V2, STATL_BASE_URL
from di.invoice_rules import RETAIL_PRICE_SALE_TYPES, row_needs_retail_price, row_needs_sro

LOOKUP_TIMEOUT = (3, 8)
VALIDATE_TIMEOUT = (5, 25)
MAX_ROWS = 15
MAX_ITEMS = 50
RESULT_CHARS = 10000
INVOICE_DOCTYPE = "Sale Tax Invoice"
SELLER_DOCTYPE = "Seller Or Company"
# Per turn: an injected loop must not be able to create masters or burn FBR calls endlessly.
WRITE_CALLS_PER_TURN = 6
VALIDATE_CALLS_PER_TURN = 3
LOOKUP_CALLS_PER_TURN = 12
DUPLICATE_WINDOW_MINUTES = 10


class ToolError(Exception):
	"""A message for the model, not a crash."""


# ---------------------------------------------------------------------------
# access


def current_user_role(user=None) -> str | None:
	"""'System Manager', 'DI Panel User' or None (no access, including the demo viewer)."""
	from di.demo import is_demo_viewer
	from di.panel import is_panel_user

	user = user or frappe.session.user
	if user in ("Guest", ""):
		return None
	roles = set(frappe.get_roles(user))
	if user == "Administrator" or "System Manager" in roles:
		return "System Manager"
	if is_demo_viewer(user):
		return None
	if is_panel_user(user):
		return "DI Panel User"
	return None


def allowed_sellers(user=None) -> list[str]:
	role = current_user_role(user)
	if role == "System Manager":
		return frappe.get_all(SELLER_DOCTYPE, pluck="name", order_by="name asc", limit_page_length=0)
	if role == "DI Panel User":
		from di.panel import get_allowed_sellers

		return [name for name in get_allowed_sellers(user) if frappe.db.exists(SELLER_DOCTYPE, name)]
	return []


def fixed_seller(user=None) -> str | None:
	"""The only seller a user may use, when there is exactly one (never ask which company)."""
	sellers = allowed_sellers(user)
	return sellers[0] if len(sellers) == 1 else None


def require_seller(seller) -> str:
	seller = cstr(seller).strip()
	allowed = allowed_sellers()
	match = (
		seller
		if seller in allowed
		else next((name for name in allowed if name.lower() == seller.lower()), None)
	)
	if not match:
		raise ToolError(
			f"Seller {seller!r} is not available to this user. Allowed sellers: {', '.join(allowed) or 'none'}."
		)
	# Belt and braces: the has_permission hook in di.panel scopes sellers too.
	if not frappe.has_permission(SELLER_DOCTYPE, "read", doc=match):
		raise ToolError(f"Seller {match!r} is not available to this user.")
	return match


def seller_token(seller, environment=None) -> str:
	doc = frappe.get_doc(SELLER_DOCTYPE, seller)
	order = (
		("production_token", "sandbox_token")
		if environment == "Production"
		else ("sandbox_token", "production_token")
	)
	for field in order:
		token = cstr(doc.get_password(field, raise_exception=False) or "").strip()
		if token:
			return token
	raise ToolError(
		f"{seller} has no FBR token saved on its Seller / Company record, so FBR lookups are not possible."
	)


def seller_has_token(seller, environment) -> bool:
	field = "production_token" if environment == "Production" else "sandbox_token"
	doc = frappe.get_doc(SELLER_DOCTYPE, seller)
	return bool(cstr(doc.get_password(field, raise_exception=False) or "").strip())


def effective_environment(settings=None) -> str:
	"""Client panel users always file on Production (the controller enforces it:
	SaleTaxInvoice._enforce_production_for_panel); administrators get the configured default."""
	if current_user_role() == "DI Panel User":
		return "Production"
	return getattr(settings, "default_environment", "Production") if settings else "Production"


def _settings_required(settings, flag, what):
	if settings is not None and not getattr(settings, flag, True):
		raise ToolError(f"{what} is switched off in DI AI Settings.")


def _count_call(settings, bucket, limit, what):
	counters = getattr(settings, "counters", None)
	if counters is None:
		return
	counters[bucket] = counters.get(bucket, 0) + 1
	if counters[bucket] > limit:
		raise ToolError(
			f"Too many {what} in one turn ({limit}). Summarise and ask the user before continuing."
		)


def _has_permission(doctype, ptype, doc) -> bool:
	return bool(frappe.has_permission(doctype, ptype, doc=doc))


# ---------------------------------------------------------------------------
# helpers


def _clean(value, limit=140) -> str:
	return " ".join(cstr(value).split())[:limit]


def _words(query) -> list[str]:
	return [w for w in _clean(query, 200).lower().split() if len(w) >= 2]


def _matches(text, words) -> bool:
	haystack = cstr(text).lower()
	return all(word in haystack for word in words)


def _normalise_environment(value, default) -> str:
	text = cstr(value).strip().lower()
	if text in ("production", "prod", "live"):
		return "Production"
	if text in ("sandbox", "test", "sb"):
		return "Sandbox"
	if text:
		raise ToolError("environment must be 'Sandbox' or 'Production'.")
	return default


def _environment_for_user(requested, settings) -> str:
	"""The environment a new draft gets. Panel users have no sandbox at all."""
	environment = _normalise_environment(requested, effective_environment(settings))
	if current_user_role() == "DI Panel User" and environment != "Production":
		raise ToolError(
			"Client panel accounts file on FBR Production only; there is no sandbox for this login. "
			"Tell the user a Production draft will be created and ask them to confirm."
		)
	return environment


def _parse_date(value) -> str:
	text = cstr(value).strip()
	if not text or text.lower() == "today":
		return nowdate()
	try:
		return getdate(text).strftime("%Y-%m-%d")
	except Exception:
		raise ToolError(f"invoice_date {text!r} is not a date; use YYYY-MM-DD.")


def _fbr_rows(url, token, context, params, method="GET", body=None, settings=None) -> list:
	from di.integrations.http import FBRError
	from di.integrations.http import get as fbr_get
	from di.integrations.http import post as fbr_post

	# Every reference call spends the seller's token; a looping model gets a dozen per turn.
	_count_call(settings, "lookups", LOOKUP_CALLS_PER_TURN, "FBR lookups")
	try:
		if method == "POST":
			data = fbr_post(url, token, body, context, timeout=LOOKUP_TIMEOUT)
		else:
			data = fbr_get(url, token, context, params=params, timeout=LOOKUP_TIMEOUT)
	except FBRError as exc:
		raise ToolError(f"FBR lookup failed ({context}): {rules.clip(cstr(exc), 300)}")
	if isinstance(data, dict):
		for key in ("data", "result", "results", "items"):
			if isinstance(data.get(key), list):
				return data[key]
		return [data]
	return data if isinstance(data, list) else []


def _province_code(seller) -> int:
	province = cstr(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_province"))
	code = frappe.db.get_value("Province", province, "province_code") if province else None
	if not code:
		raise ToolError(
			f"No FBR province code for {province or 'the seller province'}. Sync Provinces in DI Settings."
		)
	return cint(code)


def _reference_date(value=None) -> str:
	return getdate(value or nowdate()).strftime("%d-%b-%Y")


def _buyer_row(row) -> dict:
	return {
		"name": row.get("name"),
		"registration_type": row.get("buyer_registration_type"),
		"ntn_cnic": rules.mask_identity(row.get("buyer_ntncnic")),
		"province": row.get("buyer_province"),
		"address": rules.clip(row.get("buyer_address"), 120),
		"seller": row.get("seller") or "shared",
		"fbr_status": row.get("fbr_registration_status") or "",
	}


def _tax_item_row(row) -> dict:
	return {
		"name": row.get("name"),
		"hs_code": row.get("hs_code"),
		"uom": row.get("product_uom"),
		"tax_desc": row.get("tax_desc"),
		"rate_in_p": flt(row.get("rate_in_p")),
		"sale_type": row.get("transaction_type") or "",
		"fixed_rs": flt(row.get("fixed_rs")),
		"rate_id": cint(row.get("rate_id")) or None,
		"seller": row.get("seller") or "shared",
	}


_TAX_ITEM_FIELDS = [
	"name",
	"hs_code",
	"product_uom",
	"tax_desc",
	"rate_in_p",
	"transaction_type",
	"fixed_rs",
	"rate_id",
	"seller",
]


def invoice_summary(doc) -> dict:
	rows = []
	for row in doc.get("invoice_items") or []:
		rows.append(
			{
				"idx": row.idx,
				"item": row.description,
				"hs_code": row.hs_code,
				"uom": row.uom,
				"quantity": flt(row.quantity),
				"sale_rate": flt(row.sale_rate),
				"discount": flt(row.discount),
				"rate": row.rate_in_percentage,
				"rate_percent": flt(row.tax_rate_value),
				"sale_type": row.sale_type,
				"value_excl_tax": flt(row.value_sales_excluding_st),
				"sales_tax": flt(row.sales_tax_applicable),
				"total": flt(row.total_values),
				"sro_schedule_no": row.sro_schedule_no or "",
				"sro_item_serial_no": row.sro_item_serial_no or "",
				"fixed_notified_value_or_retail_price": flt(row.fixed_notified_value_or_retail_price),
			}
		)
	status = {0: "Draft", 1: "Submitted", 2: "Cancelled"}.get(cint(doc.docstatus), "Draft")
	return {
		"name": doc.name,
		"status": status,
		"seller": doc.seller__business_name,
		"buyer": doc.buyer,
		"buyer_registration_type": doc.buyer_registration_type,
		"buyer_ntn_cnic": rules.mask_identity(doc.buyer_ntncnic),
		"environment": doc.fbr_environment,
		"invoice_date": cstr(doc.invoice_date),
		"invoice_type": doc.invoice_type,
		"scenario_id": doc.scenario_id,
		"fbr_invoice_no": doc.fbr_invoice_no or "",
		"total_excl_tax": flt(doc.total_sales),
		"total_tax": flt(doc.total_taxes),
		"grand_total": flt(doc.total_sales_with_taxes),
		"items": rows,
		"url": f"/desk/sale-tax-invoice/{doc.name}",
	}


def invoice_warnings(doc) -> list[str]:
	"""What would still fail Submit, in words the model relays as 'Open questions'."""
	warnings = []
	seller = cstr(doc.seller__business_name)
	environment = cstr(doc.fbr_environment)
	try:
		if seller and environment and not seller_has_token(seller, environment):
			warnings.append(
				f"Submit will fail: {seller} has no {environment.lower()} token saved on its Seller / Company record."
			)
	except Exception:
		pass
	seller_ntn = rules.normalize_tax_id(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_ntncnic"))[0]
	buyer_ntn = rules.normalize_tax_id(doc.buyer_ntncnic)[0]
	if seller_ntn and buyer_ntn and seller_ntn == buyer_ntn:
		warnings.append("Buyer and seller share one NTN/CNIC; FBR refuses self-invoicing (0058).")
	for row in doc.get("invoice_items") or []:
		if row_needs_sro(row.tax_rate_value, row.sale_type, row.sro_schedule_no):
			warnings.append(
				f"Row {row.idx} ({row.description}): sale type {row.sale_type!r} needs an SRO schedule and item serial "
				"before FBR will accept it (errors 0077/0078). Use lookup_fbr_rate, lookup_sro_schedules and "
				"lookup_sro_serials, then update_draft_invoice."
			)
		elif cstr(row.sro_schedule_no).strip() and not cstr(row.sro_item_serial_no).strip():
			warnings.append(
				f"Row {row.idx} ({row.description}): SRO schedule {row.sro_schedule_no!r} needs its item serial "
				"(error 0078). Use lookup_sro_serials, then update_draft_invoice."
			)
		if rules.is_flat_rupee_rate(row.rate_in_percentage):
			warnings.append(
				f"Row {row.idx} ({row.description}): rate {row.rate_in_percentage!r} is rupees per unit, but the "
				"sales tax shown here is computed as a percentage and is wrong (0105). This line must be entered by hand."
			)
		if row_needs_retail_price(row.sale_type, row.fixed_notified_value_or_retail_price):
			warnings.append(
				f"Row {row.idx} ({row.description}): sale type {row.sale_type!r} needs a fixed/notified value or "
				"retail price (error 0090)."
			)
		elif row.sale_type in RETAIL_PRICE_SALE_TYPES and flt(
			row.fixed_notified_value_or_retail_price
		) == flt(row.sale_rate):
			warnings.append(
				f"Row {row.idx} ({row.description}): the retail price was taken from the sale rate; confirm the printed "
				"retail price (MRP) with the user."
			)
		cached_uom = cstr(frappe.db.get_value("HS Code", row.hs_code, "uom")) if row.hs_code else ""
		if cached_uom and cached_uom != cstr(row.uom):
			warnings.append(
				f"Row {row.idx} ({row.description}): UOM {row.uom!r} differs from the FBR unit cached for HS "
				f"{row.hs_code} ({cached_uom}). FBR allows several units for some codes but may answer 0099: confirm "
				"with lookup_fbr_uom and fix the Tax Item with update_tax_item if needed."
			)
		elif not cached_uom and row.hs_code:
			warnings.append(
				f"Row {row.idx} ({row.description}): FBR's UOM for HS {row.hs_code} is not confirmed yet; "
				"verify with lookup_fbr_uom."
			)
	try:
		if cstr(doc.invoice_date) > nowdate():
			warnings.append("The invoice date is in the future; FBR may reject it.")
	except Exception:
		pass
	return warnings


def _load_invoice(name, ptype="read"):
	name = cstr(name).strip()
	if not name or not frappe.db.exists(INVOICE_DOCTYPE, name):
		raise ToolError(f"Sale Tax Invoice {name!r} was not found.")
	doc = frappe.get_doc(INVOICE_DOCTYPE, name)
	if not _has_permission(INVOICE_DOCTYPE, ptype, doc):
		raise ToolError(f"Sale Tax Invoice {name!r} was not found.")
	require_seller(doc.seller__business_name)
	return doc


# ---------------------------------------------------------------------------
# buyers


def _buyer_list(seller, extra_filters=None):
	return frappe.get_list(
		"Buyer",
		fields=[
			"name",
			"buyer_registration_type",
			"buyer_ntncnic",
			"buyer_province",
			"buyer_address",
			"seller",
		],
		filters=extra_filters or [],
		or_filters=[["Buyer", "seller", "=", seller], ["Buyer", "seller", "is", "not set"]],
		order_by="modified desc",
		limit_page_length=300,
	)


def search_buyers(seller, query, settings=None) -> dict:
	seller = require_seller(seller)
	words = _words(query)
	# Only a query that is nothing but a number searches NTN/CNIC values; "Shop 1" is a name.
	id_query = (
		rules.normalize_tax_id(query)[0] if re.fullmatch(r"[\d\s\-]+", cstr(query).strip() or "x") else ""
	)
	found = []
	for row in _buyer_list(seller):
		if id_query:
			if len(id_query) < 4 or id_query not in rules.normalize_tax_id(row.get("buyer_ntncnic"))[0]:
				continue
		elif words and not _matches(row.get("name"), words):
			continue
		found.append(_buyer_row(row))
	exact = [row for row in found if cstr(row["name"]).lower() == _clean(query).lower()]
	return {
		"ok": True,
		"seller": seller,
		"buyers": found[:MAX_ROWS],
		"total_matches": len(found),
		"exact_match": exact[0]["name"] if len(exact) == 1 else "",
	}


def create_buyer(seller, name, registration_type, ntn_cnic, province, address, settings=None) -> dict:
	_count_call(settings, "writes", WRITE_CALLS_PER_TURN, "master records created")
	seller = require_seller(seller)
	name = _clean(name)
	if len(name) < 2:
		raise ToolError("name is required.")
	if "<" in name or ">" in name:
		raise ToolError("name cannot contain < or >.")
	registration_type = cstr(registration_type).strip().title()
	error = rules.buyer_identity_error(registration_type, ntn_cnic)
	if error:
		raise ToolError(error)
	number = rules.normalize_tax_id(ntn_cnic)[0]
	province_name = rules.normalize_province(province)
	if not province_name:
		raise ToolError(f"province must be one of: {', '.join(rules.PROVINCES)}.")
	address = _clean(address, 500)
	if len(address) < 3:
		raise ToolError("address is required.")

	seller_ntn = rules.normalize_tax_id(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_ntncnic"))[0]
	if seller_ntn and number == seller_ntn:
		raise ToolError("The buyer's NTN/CNIC is the seller's own; FBR refuses self-invoicing (error 0058).")

	for row in _buyer_list(seller):
		if (
			rules.normalize_tax_id(row.get("buyer_ntncnic"))[0] == number
			or cstr(row.get("name")).lower() == name.lower()
		):
			return {
				"ok": True,
				"created": False,
				"note": "A matching buyer already exists for this seller; use it instead of creating a duplicate.",
				"buyer": _buyer_row(row),
			}

	final_name = rules.unique_name(name, lambda value: frappe.db.exists("Buyer", value), seller)
	doc = frappe.get_doc(
		{
			"doctype": "Buyer",
			"seller": seller,
			"buyer_businessname": final_name,
			"buyer_registration_type": registration_type,
			"buyer_ntncnic": number,
			"buyer_province": province_name,
			"buyer_address": address,
		}
	)
	if not _has_permission("Buyer", "write", doc):
		raise ToolError("You cannot create buyers for this seller.")
	doc.insert()
	frappe.db.commit()
	result = {"ok": True, "created": True, "buyer": _buyer_row(doc.as_dict())}
	if final_name != name:
		result["note"] = (
			f"The record was stored as {final_name!r} because {name!r} was already in use. FBR receives the plain "
			f"name {name!r}; the desk and the printed invoice show the record name."
		)
	return result


def check_buyer_registration(ntn_cnic, seller, settings=None) -> dict:
	"""Ask FBR (STATL Get_Reg_Type) whether this NTN/CNIC is registered for sales tax."""
	_settings_required(settings, "allow_fbr_lookups", "FBR reference lookups")
	seller = require_seller(seller)
	number, kind = rules.normalize_tax_id(ntn_cnic)
	if not kind:
		raise ToolError("Give a 7-digit NTN (or 1234567-8) or a 13-digit CNIC.")
	# Sandbox tokens answer "unregistered" for real registered NTNs (REVIEW.md 2.7).
	if not seller_has_token(seller, "Production"):
		raise ToolError(
			f"{seller} has no production token, so FBR registration status cannot be checked. Ask the user."
		)
	token = seller_token(seller, "Production")
	rows = _fbr_rows(
		f"{STATL_BASE_URL}/Get_Reg_Type",
		token,
		"buyer registration type",
		None,
		method="POST",
		body={"registrationNo": number},
		settings=settings,
	)
	body = rows[0] if rows and isinstance(rows[0], dict) else {}
	raw = cstr(
		body.get("REGISTRATION_TYPE") or body.get("registrationType") or body.get("registration_type") or ""
	)
	status = "Registered" if raw.strip().lower().startswith("reg") else "Unregistered" if raw else ""
	return {
		"ok": True,
		"ntn_cnic": rules.mask_identity(number),
		"kind": kind,
		"registration_type": status,
		"fbr_answer": rules.clip(raw or json.dumps(body, default=str), 200),
	}


# ---------------------------------------------------------------------------
# items and HS codes


def _tax_item_list(seller, extra_filters=None):
	return frappe.get_list(
		"Tax Item",
		fields=_TAX_ITEM_FIELDS,
		filters=extra_filters or [],
		or_filters=[["Tax Item", "seller", "=", seller], ["Tax Item", "seller", "is", "not set"]],
		order_by="modified desc",
		limit_page_length=500,
	)


def search_tax_items(seller, query, settings=None) -> dict:
	seller = require_seller(seller)
	words = _words(query)
	found = []
	for row in _tax_item_list(seller):
		if words and not (_matches(row.get("name"), words) or _matches(row.get("hs_code"), words)):
			continue
		found.append(_tax_item_row(row))
	exact = [row for row in found if cstr(row["name"]).lower() == _clean(query).lower()]
	return {
		"ok": True,
		"seller": seller,
		"tax_items": found[:MAX_ROWS],
		"total_matches": len(found),
		"exact_match": exact[0]["name"] if len(exact) == 1 else "",
	}


def search_hs_codes(query, limit=10, settings=None) -> dict:
	query = cstr(query).strip()
	# Only a query that IS a code is normalised; "filter 84212100" keeps its words.
	if re.fullmatch(r"\d{4}[ .]?\d{4}", query):
		query = rules.normalize_hs_code(query)
	codes = hs_search.search(query, limit)
	return {
		"ok": True,
		"query": _clean(query, 200),
		"codes": codes,
		"hint": ""
		if codes
		else "No match. Try another phrasing: the material, the product family, or what it is used for.",
	}


def get_hs_code(hs_code, settings=None) -> dict:
	row = hs_search.get(rules.normalize_hs_code(hs_code))
	if not row:
		raise ToolError(
			f"HS code {cstr(hs_code).strip()!r} is not in the FBR master. Search for the right one with search_hs_codes."
		)
	return {"ok": True, "code": row}


def _fbr_uoms(hs_code, seller, settings) -> list[str]:
	token = seller_token(seller, effective_environment(settings))
	annexure = frappe.db.get_value("DI Settings", {"company": seller}, "annexure_id") or DEFAULT_ANNEXURE_ID
	rows = _fbr_rows(
		f"{REF_BASE_V2}/HS_UOM",
		token,
		f"UOM for {hs_code}",
		{"hs_code": hs_code, "annexure_id": annexure},
		settings=settings,
	)
	from di.integrations.reference_api import _row_value

	uoms = []
	for row in rows:
		uom = cstr(_row_value(row, "description")).strip()
		if uom and uom not in uoms:
			uoms.append(uom)
	# One answer from FBR is a fact worth remembering on the shared master; several are
	# not, and only a user who may write HS Code (System Manager) writes it there.
	if (
		len(uoms) == 1
		and frappe.has_permission("HS Code", "write")
		and not frappe.db.get_value("HS Code", hs_code, "uom")
		and frappe.db.exists("HS Uom", uoms[0])
	):
		frappe.db.set_value("HS Code", hs_code, "uom", uoms[0], update_modified=False)
		frappe.db.commit()
	return uoms


def lookup_fbr_uom(hs_code, seller, settings=None) -> dict:
	_settings_required(settings, "allow_fbr_lookups", "FBR reference lookups")
	seller = require_seller(seller)
	code = rules.normalize_hs_code(hs_code)
	if not frappe.db.exists("HS Code", code):
		raise ToolError(f"HS code {code!r} is not in the master.")
	uoms = _fbr_uoms(code, seller, settings)
	return {
		"ok": True,
		"hs_code": code,
		"uoms": uoms,
		"note": "" if uoms else "FBR returned no UOM for this code; check the HS code.",
	}


def _resolve_sale_type_id(sale_type):
	from di.digital_invoicing.doctype.tax_item.tax_item import _resolve_transaction_type

	resolved = _resolve_transaction_type(sale_type) if cstr(sale_type).strip() else None
	if resolved and cstr(resolved.get("transaction_type")).lower() == cstr(sale_type).strip().lower():
		return resolved
	# _resolve_transaction_type falls back to the standard type; only accept an exact name match.
	return None


def lookup_fbr_rate(hs_code, uom, sale_type, seller, date=None, settings=None) -> dict:
	_settings_required(settings, "allow_fbr_lookups", "FBR reference lookups")
	seller = require_seller(seller)
	sale_type = cstr(sale_type).strip() or rules.STANDARD_SALE_TYPE
	resolved = _resolve_sale_type_id(sale_type)
	if not resolved:
		known = frappe.get_all("Transaction Type", filters={"transaction_type_id": [">", 0]}, pluck="name")
		raise ToolError(
			f"Sale type {sale_type!r} has no FBR transaction type id. Known: {', '.join(known)[:600]}."
		)
	token = seller_token(seller, effective_environment(settings))
	rows = _fbr_rows(
		f"{REF_BASE_V2}/SaleTypeToRate",
		token,
		f"rates for {sale_type}",
		{
			"date": _reference_date(date),
			"transTypeId": cint(resolved["transaction_type_id"]),
			"originationSupplier": _province_code(seller),
		},
		settings=settings,
	)
	from di.digital_invoicing.doctype.tax_item.tax_item import _normalise_rate_row, _select_rate_option

	options = [row for row in (_normalise_rate_row(r) for r in rows) if row.get("tax_desc")]
	if not options:
		raise ToolError(f"FBR returned no rate for sale type {sale_type!r}.")
	selected, ambiguous = _select_rate_option(options, uom)
	return {
		"ok": True,
		"hs_code": rules.normalize_hs_code(hs_code),
		"sale_type": resolved["transaction_type"],
		"selected": selected,
		"ambiguous": bool(ambiguous),
		"options": options[:MAX_ROWS],
	}


def lookup_sro_schedules(rate_id, seller, settings=None) -> dict:
	_settings_required(settings, "allow_fbr_lookups", "FBR reference lookups")
	seller = require_seller(seller)
	rate_id = cint(rate_id)
	if not rate_id:
		raise ToolError("rate_id is required; get it from lookup_fbr_rate.")
	token = seller_token(seller, effective_environment(settings))
	rows = _fbr_rows(
		f"{REF_BASE_V1}/SroSchedule",
		token,
		f"SRO schedules for rate {rate_id}",
		{"date": _reference_date(), "rate_id": rate_id, "origination_supplier_csv": _province_code(seller)},
		settings=settings,
	)
	from di.integrations.reference_api import _row_value

	# Reference data: a schedule must exist in the master before an invoice row can link
	# to it. As on the desk (reference_api.get_sro_schedules_for_rate), only a user who may
	# write SRO Schedule saves new rows; everyone else gets the list and a note.
	can_cache = frappe.has_permission("SRO Schedule", "write")
	schedules = []
	missing = []
	for row in rows:
		desc = cstr(_row_value(row, "srO_DESC", "sro_desc", "description")).strip()
		sro_id = cint(_row_value(row, "srO_ID", "sro_id", "id"))
		if not desc:
			continue
		schedules.append({"sro_id": sro_id, "sro_desc": desc})
		if frappe.db.exists("SRO Schedule", desc):
			continue
		if can_cache:
			frappe.get_doc({"doctype": "SRO Schedule", "sro_desc": desc, "sro_id": sro_id}).insert(
				ignore_permissions=True
			)
		else:
			missing.append(desc)
	if can_cache and schedules:
		frappe.db.commit()
	result = {"ok": True, "rate_id": rate_id, "schedules": schedules[:MAX_ROWS]}
	if missing:
		result["note"] = (
			f"{len(missing)} of these schedules are not in the site's SRO Schedule master yet and this login "
			"cannot add them, and a draft can only use a schedule that exists. Ask the Sheikh Mahboob office "
			"to sync SRO schedules in DI Settings."
		)
	return result


def lookup_sro_serials(sro_id, seller, settings=None) -> dict:
	_settings_required(settings, "allow_fbr_lookups", "FBR reference lookups")
	seller = require_seller(seller)
	sro_id = cint(sro_id)
	if not sro_id:
		raise ToolError("sro_id is required; get it from lookup_sro_schedules.")
	token = seller_token(seller, effective_environment(settings))
	rows = _fbr_rows(
		f"{REF_BASE_V2}/SROItem",
		token,
		f"SRO serials for schedule {sro_id}",
		{"date": getdate(nowdate()).strftime("%Y-%m-%d"), "sro_id": sro_id},
		settings=settings,
	)
	serials = []
	for row in rows:
		serial = cstr(row.get("srO_ITEM_DESC") if isinstance(row, dict) else "").strip()
		if serial and serial not in serials:
			serials.append(serial)
	schedule = frappe.db.get_value("SRO Schedule", {"sro_id": sro_id}, "name") or ""
	return {"ok": True, "sro_id": sro_id, "sro_schedule_no": schedule, "serials": serials[:60]}


def _validate_item_fields(
	seller,
	hs_code,
	uom,
	tax_desc,
	rate_in_p,
	sale_type,
	settings,
	*,
	cached_uom_required=True,
	stored_tax_desc=None,
):
	"""Shared by create_tax_item and update_tax_item. Returns the cleaned values.

	`stored_tax_desc` is the rate text an existing item already carries: it is not
	being set here, so it is kept even when it could not be created now (a flat
	rupee rate), which lets the UOM or HS code of such an item be repaired.
	"""
	hs_code = rules.normalize_hs_code(hs_code)
	if not frappe.db.exists("HS Code", hs_code):
		raise ToolError(f"HS code {hs_code!r} is not in the master; verify it with search_hs_codes first.")

	uom_name = rules.normalize_uom(uom)
	if not uom_name and frappe.db.exists("HS Uom", cstr(uom).strip()):
		uom_name = cstr(uom).strip()
	if not uom_name:
		raise ToolError(f"uom {cstr(uom)!r} is not an FBR unit. Allowed: {', '.join(PRODUCT_UOM_OPTIONS)}.")
	# FBR allows specific units per HS code (error 0099), and several for some codes
	# (2711.2100 takes MMBTU and KG). The master caches one of them, so the cache is a
	# hint: FBR's live list is the verdict when it can be asked, a warning otherwise. An
	# alias of the user's wording never decides.
	assumptions = []
	cached_uom = cstr(frappe.db.get_value("HS Code", hs_code, "uom"))
	lookups_allowed = settings is not None and getattr(settings, "allow_fbr_lookups", True)
	if cached_uom != uom_name and cached_uom_required and lookups_allowed and seller:
		try:
			allowed = _fbr_uoms(hs_code, seller, settings)
		except ToolError:
			allowed = []
		if allowed and uom_name not in allowed:
			raise ToolError(f"FBR allows {', '.join(allowed)} for HS {hs_code}, not {uom_name!r}.")
		if not allowed:
			assumptions.append(_uom_unconfirmed(uom_name, cached_uom, hs_code))
	elif cached_uom != uom_name:
		assumptions.append(_uom_unconfirmed(uom_name, cached_uom, hs_code))

	parsed = rules.parse_rate(tax_desc)
	if parsed:
		tax_desc, rate_value = parsed
	else:
		tax_desc = _clean(tax_desc, 80)
		if not tax_desc:
			raise ToolError("tax_desc is required, e.g. '18%'.")
		if rules.is_flat_rupee_rate(tax_desc) and tax_desc != _clean(stored_tax_desc, 80):
			raise ToolError(
				f"Rate {tax_desc!r} is a rupee amount per unit. The desk cannot compute that sales tax yet; "
				"the clerk must enter this line by hand."
			)
		leading = rules.leading_percent(tax_desc)
		if tax_desc.lower() == "exempt":
			rate_value = 0.0
		elif leading is not None:
			# '18% along with rupees 60 per kilogram': the percentage part is the rate number.
			rate_value = leading
		else:
			rate_value = flt(rate_in_p)
	if rate_in_p not in (None, "") and abs(flt(rate_in_p) - rate_value) > 0.001:
		raise ToolError(f"rate_in_p {rate_in_p} does not match tax_desc {tax_desc!r}.")

	sale_type = cstr(sale_type).strip()
	if sale_type:
		stored = frappe.db.exists("Transaction Type", sale_type)
		if not stored:
			resolved = _resolve_sale_type_id(sale_type)
			if not resolved:
				raise ToolError(
					f"Sale type {sale_type!r} is not a Transaction Type on this site; pick one from CONTEXT.sale_types."
				)
			sale_type = resolved["transaction_type"]
		elif isinstance(stored, str):
			# MariaDB matches names without regard to case; keep the stored spelling.
			sale_type = stored
	else:
		inferred, reason = rules.infer_sale_type("", tax_desc, rate_value)
		if not inferred:
			raise ToolError(f"sale_type is required: {reason}.")
		if not frappe.db.exists("Transaction Type", inferred):
			raise ToolError(f"sale_type is required ({inferred!r} is not a Transaction Type on this site).")
		sale_type = inferred
		assumptions.append(f"Sale type {inferred!r} {reason}.")
	mismatch = rules.standard_rate_mismatch(sale_type, tax_desc, rate_value)
	if mismatch:
		raise ToolError(mismatch)
	return hs_code, uom_name, tax_desc, rate_value, sale_type, assumptions


def _uom_unconfirmed(uom_name, cached_uom, hs_code) -> str:
	if cached_uom:
		return (
			f"UOM {uom_name!r} differs from the FBR unit cached for HS {hs_code} ({cached_uom}) and could not be "
			"confirmed with FBR now; run lookup_fbr_uom before the invoice is submitted (error 0099)."
		)
	return (
		f"UOM {uom_name!r} for HS {hs_code} could not be confirmed with FBR now; run lookup_fbr_uom before "
		"the invoice is submitted (error 0099)."
	)


def create_tax_item(
	seller,
	description,
	hs_code,
	uom,
	tax_desc,
	rate_in_p,
	sale_type=None,
	fixed_rs=None,
	rate_id=None,
	settings=None,
) -> dict:
	_count_call(settings, "writes", WRITE_CALLS_PER_TURN, "master records created")
	seller = require_seller(seller)
	description = _clean(description)
	if len(description) < 2:
		raise ToolError("description is required (max 140 characters).")
	if "<" in description or ">" in description:
		raise ToolError("description cannot contain < or >.")

	hs_code, uom_name, tax_desc, rate_value, sale_type, assumptions = _validate_item_fields(
		seller, hs_code, uom, tax_desc, rate_in_p, sale_type, settings
	)

	for row in _tax_item_list(seller):
		if cstr(row.get("name")).lower() == description.lower():
			return {
				"ok": True,
				"created": False,
				"note": "An item with this name already exists for this seller.",
				"tax_item": _tax_item_row(row),
			}

	final_name = rules.unique_name(description, lambda value: frappe.db.exists("Tax Item", value), seller)
	values = {
		"doctype": "Tax Item",
		"seller": seller,
		"product_description": final_name,
		"hs_code": hs_code,
		"product_uom": uom_name,
		"tax_desc": tax_desc,
		"rate_in_p": rate_value,
		"transaction_type": sale_type,
		"fixed_rs": flt(fixed_rs) if fixed_rs not in (None, "") else 0,
	}
	if rate_id not in (None, ""):
		values["rate_id"] = cint(rate_id)
	doc = frappe.get_doc(values)
	if not _has_permission("Tax Item", "write", doc):
		raise ToolError("You cannot create items for this seller.")
	doc.insert()
	frappe.db.commit()
	result = {
		"ok": True,
		"created": True,
		"tax_item": _tax_item_row(doc.as_dict()),
		"assumptions": assumptions,
	}
	if final_name != description:
		result["note"] = (
			f"The item was stored as {final_name!r} because {description!r} was already in use; FBR receives "
			f"{description!r} (the seller suffix is stripped from the payload)."
		)
	return result


def update_tax_item(
	name,
	uom=None,
	hs_code=None,
	tax_desc=None,
	rate_in_p=None,
	sale_type=None,
	rate_id=None,
	fixed_rs=None,
	settings=None,
) -> dict:
	"""Fix an item in place; every draft that uses it picks the change up on its next save."""
	_count_call(settings, "writes", WRITE_CALLS_PER_TURN, "master records changed")
	name = cstr(name).strip()
	if not name or not frappe.db.exists("Tax Item", name):
		raise ToolError(f"Tax Item {name!r} was not found.")
	doc = frappe.get_doc("Tax Item", name)
	if not _has_permission("Tax Item", "write", doc):
		raise ToolError(f"Tax Item {name!r} was not found.")
	seller = cstr(doc.seller)
	if seller:
		require_seller(seller)
	elif current_user_role() != "System Manager":
		raise ToolError("Shared items can only be changed by an administrator.")

	new_text = cstr(tax_desc).strip()
	hs_code, uom_name, tax_desc, rate_value, sale_type, assumptions = _validate_item_fields(
		seller or (fixed_seller() or ""),
		hs_code or doc.hs_code,
		uom or doc.product_uom,
		new_text or doc.tax_desc,
		# A new rate text with no number: the number comes from the text, not from the old rate.
		rate_in_p if rate_in_p not in (None, "") else (None if new_text else doc.rate_in_p),
		sale_type or doc.transaction_type,
		settings,
		cached_uom_required=bool(seller),
		stored_tax_desc=doc.tax_desc,
	)
	stored_parsed = rules.parse_rate(doc.tax_desc)
	stored_text = stored_parsed[0] if stored_parsed else _clean(doc.tax_desc, 80)
	rate_changed = (
		tax_desc != stored_text
		or abs(flt(rate_value) - flt(doc.rate_in_p)) > 0.001
		or sale_type.casefold() != cstr(doc.transaction_type).casefold()
	)
	doc.hs_code = hs_code
	doc.product_uom = uom_name
	doc.tax_desc = tax_desc
	doc.rate_in_p = rate_value
	doc.transaction_type = sale_type
	if rate_id not in (None, ""):
		doc.rate_id = cint(rate_id)
	elif rate_changed and cint(doc.rate_id):
		# The old rate_id would fetch SRO schedules for the previous rate (0077/0078).
		doc.rate_id = 0
		assumptions.append(
			"rate_id was cleared because the rate or sale type changed; run lookup_fbr_rate before SRO details."
		)
	if fixed_rs not in (None, ""):
		doc.fixed_rs = flt(fixed_rs)
	doc.save()
	frappe.db.commit()
	drafts = frappe.get_list(
		INVOICE_DOCTYPE,
		filters=[[INVOICE_DOCTYPE, "docstatus", "=", 0]],
		fields=["name"],
		pluck="name",
		limit_page_length=50,
	)
	using = []
	for draft in drafts:
		if frappe.db.exists("Sale Tax Invoice Item", {"parent": draft, "description": name}):
			using.append(draft)
	return {
		"ok": True,
		"updated": True,
		"tax_item": _tax_item_row(doc.as_dict()),
		"assumptions": assumptions,
		"drafts_using_it": using[:MAX_ROWS],
		"note": "Submitted invoices keep their stored rows; drafts take the new values when saved again (update_draft_invoice).",
	}


# ---------------------------------------------------------------------------
# invoices


def list_recent_invoices(seller, buyer=None, limit=5, settings=None) -> dict:
	seller = require_seller(seller)
	filters = [
		[INVOICE_DOCTYPE, "seller__business_name", "=", seller],
		[INVOICE_DOCTYPE, "docstatus", "=", 1],
	]
	buyer = cstr(buyer).strip()
	if buyer:
		filters.append([INVOICE_DOCTYPE, "buyer", "=", buyer])
	if current_user_role() == "DI Panel User":
		filters.append([INVOICE_DOCTYPE, "fbr_environment", "=", "Production"])
	names = frappe.get_list(
		INVOICE_DOCTYPE,
		filters=filters,
		fields=["name"],
		order_by="invoice_date desc, modified desc",
		limit_page_length=max(1, min(cint(limit) or 5, 10)),
		pluck="name",
	)
	invoices = [invoice_summary(frappe.get_doc(INVOICE_DOCTYPE, name)) for name in names]
	return {
		"ok": True,
		"seller": seller,
		"invoices": invoices,
		"note": "Submitted invoices only, newest first.",
	}


def get_invoice(name, settings=None) -> dict:
	doc = _load_invoice(name, "read")
	return {"ok": True, "invoice": invoice_summary(doc), "warnings": invoice_warnings(doc)}


def _prepare_items(seller, items) -> tuple[list[dict], str, list[str]]:
	if not isinstance(items, list) or not items:
		raise ToolError("items must be a non-empty list.")
	if len(items) > MAX_ITEMS:
		raise ToolError(f"At most {MAX_ITEMS} items per invoice.")

	rows = []
	sale_types = set()
	assumptions = []
	for index, item in enumerate(items, start=1):
		if not isinstance(item, dict):
			raise ToolError(f"Item {index} must be an object.")
		tax_item = cstr(item.get("tax_item")).strip()
		master = (
			frappe.db.get_value("Tax Item", tax_item, _TAX_ITEM_FIELDS, as_dict=True) if tax_item else None
		)
		if not master or (master.seller and master.seller != seller):
			raise ToolError(
				f"Item {index}: Tax Item {tax_item!r} is not available for {seller}. Search or create it first."
			)
		quantity = rules.parse_quantity(item.get("quantity"))
		if quantity is None:
			raise ToolError(f"Item {index}: quantity must be a positive number.")
		sale_rate = rules.parse_amount(item.get("sale_rate"))
		if not sale_rate:
			raise ToolError(
				f"Item {index}: sale_rate must be a positive PKR amount per unit (excluding tax); ask the user."
			)
		discount = rules.parse_amount(item.get("discount") or 0)
		if discount is None:
			raise ToolError(f"Item {index}: discount must be a non-negative number.")
		fixed_price = rules.parse_amount(item.get("fixed_notified_value_or_retail_price") or 0)
		if fixed_price is None:
			raise ToolError(
				f"Item {index}: fixed_notified_value_or_retail_price must be a non-negative number."
			)
		if rules.is_flat_rupee_rate(master.tax_desc):
			raise ToolError(
				f"Item {index}: {tax_item!r} carries a rupee-per-unit rate ({master.tax_desc}); the desk cannot compute "
				"that sales tax yet. The clerk must enter this line by hand."
			)

		sale_type = cstr(item.get("sale_type")).strip()
		if not sale_type:
			sale_type, reason = rules.infer_sale_type(
				master.transaction_type, master.tax_desc, master.rate_in_p
			)
			if not sale_type:
				raise ToolError(f"Item {index}: {reason} (pass sale_type).")
			if reason:
				assumptions.append(f"Item {index} ({tax_item}): sale type {sale_type!r} {reason}.")
		# The master is matched without regard to case; its stored spelling is what the
		# scenario table and the controller compare against.
		canonical = frappe.db.get_value("Sale Type", sale_type, "name") if sale_type else None
		if not canonical:
			raise ToolError(f"Item {index}: sale type {sale_type!r} is not a Sale Type.")
		sale_type = cstr(canonical)
		mismatch = rules.standard_rate_mismatch(sale_type, master.tax_desc, master.rate_in_p)
		if mismatch:
			raise ToolError(f"Item {index}: {mismatch}")
		sale_types.add(sale_type)

		if sale_type in RETAIL_PRICE_SALE_TYPES and not fixed_price and not flt(master.fixed_rs):
			raise ToolError(
				f"Item {index}: sale type {sale_type!r} needs the printed retail price (MRP) per unit "
				"(fixed_notified_value_or_retail_price, FBR 0090). Ask the user."
			)
		if flt(master.fixed_rs) and fixed_price and abs(flt(master.fixed_rs) - fixed_price) > 0.01:
			assumptions.append(
				f"Item {index} ({tax_item}): the Tax Item's fixed retail price {flt(master.fixed_rs)} overrides {fixed_price}."
			)

		rows.append(
			{
				# The master's spelling and its fixed retail price are what the saved row
				# carries (Link validation and the controller rewrite both), so the twin
				# check in _recent_identical_draft compares like with like.
				"description": cstr(master.name),
				"quantity": quantity,
				"sale_rate": sale_rate,
				"discount": discount,
				"sale_type": sale_type,
				"sro_schedule_no": _clean(item.get("sro_schedule_no"), 140),
				"sro_item_serial_no": _clean(item.get("sro_item_serial_no"), 60),
				"fixed_notified_value_or_retail_price": flt(master.fixed_rs) or fixed_price,
			}
		)

	if len(sale_types) > 1:
		raise ToolError(
			"These items need different sale types (" + ", ".join(sorted(sale_types)) + "). "
			"FBR takes one sale type per invoice here: offer the user one draft per sale type."
		)
	sale_type = next(iter(sale_types))
	for row in rows:
		if row["sro_schedule_no"] and not frappe.db.exists("SRO Schedule", row["sro_schedule_no"]):
			raise ToolError(
				f"SRO schedule {row['sro_schedule_no']!r} is not in the master; use the exact name from lookup_sro_schedules."
			)
	return rows, sale_type, assumptions


def _resolve_scenario(scenario_id, sale_type, buyer_registration_type) -> str:
	scenario_id = cstr(scenario_id).strip().upper()
	if not scenario_id:
		scenario_id = rules.scenario_for(sale_type, buyer_registration_type) or ""
		if not scenario_id:
			raise ToolError(
				f"No FBR scenario fits sale type {sale_type!r} with a {rules.buyer_kind(buyer_registration_type).lower()} buyer "
				"(cotton ginner sales need a registered buyer, error 0100). Pass scenario_id explicitly or change the buyer."
			)
	if not frappe.db.exists("Scenario", scenario_id):
		raise ToolError(f"Scenario {scenario_id!r} does not exist on this site.")
	scenario_sale_type = cstr(frappe.db.get_value("Scenario", scenario_id, "sale__purchase_type"))
	# Scenario.sale__purchase_type is seeded text; the Sale Type master may spell it with other casing.
	if scenario_sale_type and scenario_sale_type.casefold() != cstr(sale_type).casefold():
		raise ToolError(
			f"Scenario {scenario_id} is for sale type {scenario_sale_type!r}, but the items are {sale_type!r}."
		)
	if not rules.scenario_matches_buyer(scenario_id, buyer_registration_type):
		raise ToolError(
			f"Scenario {scenario_id} expects a {rules.scenario_buyer_kind(scenario_id).lower()} buyer, "
			f"but {cstr(buyer_registration_type) or 'this buyer'} is not. Use the matching scenario."
		)
	return scenario_id


def _check_buyer(seller, buyer) -> dict:
	buyer = cstr(buyer).strip()
	row = (
		frappe.db.get_value(
			"Buyer", buyer, ["name", "seller", "buyer_registration_type", "buyer_ntncnic"], as_dict=True
		)
		if buyer
		else None
	)
	if not row or (row.seller and row.seller != seller) or not _has_permission("Buyer", "read", buyer):
		raise ToolError(
			f"Buyer {buyer!r} is not available for {seller}. Use search_buyers or create_buyer first."
		)
	seller_ntn = rules.normalize_tax_id(frappe.db.get_value(SELLER_DOCTYPE, seller, "seller_ntncnic"))[0]
	if seller_ntn and rules.normalize_tax_id(row.buyer_ntncnic)[0] == seller_ntn:
		raise ToolError(
			"The buyer carries the seller's own NTN/CNIC; FBR refuses self-invoicing (0058). Pick another buyer."
		)
	return row


_LINE_FIELDS = (
	"description",
	"quantity",
	"sale_rate",
	"discount",
	"sro_schedule_no",
	"sro_item_serial_no",
	"fixed_notified_value_or_retail_price",
)


def _line_key(row) -> tuple:
	return (
		cstr(row.get("description")),
		flt(row.get("quantity")),
		flt(row.get("sale_rate")),
		flt(row.get("discount")),
		cstr(row.get("sro_schedule_no")),
		cstr(row.get("sro_item_serial_no")),
		flt(row.get("fixed_notified_value_or_retail_price")),
	)


def _recent_identical_draft(seller, buyer, invoice_date, rows, environment, scenario) -> str | None:
	"""A draft this user created minutes ago with exactly these lines: return it instead of a twin.

	Every field that changes the totals or the FBR payload takes part (discount, retail
	price, SRO fields, environment, scenario), so a second request that differs in any
	of them gets its own draft.
	"""
	since = frappe.utils.add_to_date(now_datetime(), minutes=-DUPLICATE_WINDOW_MINUTES)
	wanted = sorted(_line_key(r) for r in rows)
	for name in frappe.get_list(
		INVOICE_DOCTYPE,
		filters=[
			[INVOICE_DOCTYPE, "docstatus", "=", 0],
			[INVOICE_DOCTYPE, "owner", "=", frappe.session.user],
			[INVOICE_DOCTYPE, "seller__business_name", "=", seller],
			[INVOICE_DOCTYPE, "buyer", "=", buyer],
			[INVOICE_DOCTYPE, "invoice_date", "=", invoice_date],
			[INVOICE_DOCTYPE, "fbr_environment", "=", environment],
			[INVOICE_DOCTYPE, "scenario_id", "=", scenario],
			[INVOICE_DOCTYPE, "creation", ">=", since],
		],
		pluck="name",
		limit_page_length=10,
	):
		existing = frappe.get_all(
			"Sale Tax Invoice Item",
			filters={"parent": name, "parenttype": INVOICE_DOCTYPE},
			fields=list(_LINE_FIELDS),
		)
		if sorted(_line_key(r) for r in existing) == wanted:
			return name
	return None


def create_draft_invoice(
	seller, buyer, items, environment=None, invoice_date=None, scenario_id=None, settings=None
) -> dict:
	_count_call(settings, "writes", WRITE_CALLS_PER_TURN, "drafts created")
	seller = require_seller(seller)
	buyer_row = _check_buyer(seller, buyer)
	environment = _environment_for_user(environment, settings)
	rows, sale_type, assumptions = _prepare_items(seller, items)
	scenario = _resolve_scenario(scenario_id, sale_type, buyer_row.buyer_registration_type)
	date = _parse_date(invoice_date)

	twin = _recent_identical_draft(seller, buyer_row.name, date, rows, environment, scenario)
	if twin:
		doc = frappe.get_doc(INVOICE_DOCTYPE, twin)
		return {
			"ok": True,
			"created": False,
			"note": f"Draft {twin} with exactly these lines was created a few minutes ago; it is returned instead of a duplicate.",
			"invoice": invoice_summary(doc),
			"warnings": invoice_warnings(doc),
		}

	doc = frappe.get_doc(
		{
			"doctype": INVOICE_DOCTYPE,
			"invoice_type": "Sale Invoice",
			"invoice_date": date,
			"scenario_id": scenario,
			"fbr_environment": environment,
			"buyer": buyer_row.name,
			"seller__business_name": seller,
			"invoice_items": rows,
		}
	)
	if not _has_permission(INVOICE_DOCTYPE, "write", doc):
		raise ToolError(f"You cannot create invoices for {seller}.")
	doc.insert()
	frappe.db.commit()
	# The controller may change the environment (panel users) or row sale types;
	# what is reported is what was saved, never what was asked for.
	return {
		"ok": True,
		"created": True,
		"invoice": invoice_summary(doc),
		"assumptions": assumptions,
		"warnings": invoice_warnings(doc),
	}


_UPDATABLE = ("buyer", "invoice_date", "fbr_environment", "scenario_id")


def update_draft_invoice(name, set=None, items=None, settings=None) -> dict:
	_count_call(settings, "writes", WRITE_CALLS_PER_TURN, "draft updates")
	doc = _load_invoice(name, "write")
	if cint(doc.docstatus) != 0:
		raise ToolError(
			f"{doc.name} is {'submitted' if doc.docstatus == 1 else 'cancelled'}; only drafts can be changed."
		)
	seller = doc.seller__business_name
	changes = (
		{key: value for key, value in (set or {}).items() if key in _UPDATABLE and value not in (None, "")}
		if isinstance(set, dict)
		else {}
	)
	assumptions = []

	if changes.get("buyer"):
		doc.buyer = _check_buyer(seller, changes["buyer"]).name
	if changes.get("invoice_date"):
		doc.invoice_date = _parse_date(changes["invoice_date"])
	if changes.get("fbr_environment"):
		doc.fbr_environment = _environment_for_user(changes["fbr_environment"], settings)

	buyer_row = _check_buyer(seller, doc.buyer)
	if items is not None:
		rows, sale_type, assumptions = _prepare_items(seller, items)
		doc.set("invoice_items", [])
		for row in rows:
			doc.append("invoice_items", row)
	else:
		sale_type = (
			cstr(doc.invoice_items[0].sale_type if doc.invoice_items else "") or rules.STANDARD_SALE_TYPE
		)

	if changes.get("scenario_id") or items is not None or changes.get("buyer"):
		doc.scenario_id = _resolve_scenario(
			changes.get("scenario_id"), sale_type, buyer_row.buyer_registration_type
		)

	doc.save()
	frappe.db.commit()
	if cint(doc.docstatus) != 0 or cstr(doc.fbr_invoice_no):
		frappe.log_error(frappe.get_traceback(), f"DI AI update left {doc.name} in an unexpected state")
		# run_tool rolls back after a ToolError; the log row must outlive that.
		frappe.db.commit()
		raise ToolError(f"{doc.name} is no longer a plain draft; stop and tell the user to open it.")
	return {
		"ok": True,
		"updated": True,
		"invoice": invoice_summary(doc),
		"assumptions": assumptions,
		"warnings": invoice_warnings(doc),
	}


def preview_fbr_payload(name, settings=None) -> dict:
	doc = _load_invoice(name, "read")
	from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

	payload = build_sale_tax_invoice_payload(doc)
	# The model never needs full tax identities; the desk's own preview shows them.
	for key in ("buyerNTNCNIC", "sellerNTNCNIC"):
		if payload.get(key):
			payload[key] = rules.mask_identity(payload[key])
	return {
		"ok": True,
		"name": doc.name,
		"payload": payload,
		"note": "NTN/CNIC values are masked here; the payload sent to FBR carries them in full.",
	}


def validate_with_fbr(name, settings=None) -> dict:
	"""Validate only, with a short timeout, logging the outcome like the desk button does."""
	_settings_required(settings, "allow_fbr_validate", "FBR validate")
	_count_call(settings, "validates", VALIDATE_CALLS_PER_TURN, "FBR validations")
	doc = _load_invoice(name, "write")
	if cint(doc.docstatus) != 0:
		raise ToolError(f"{doc.name} is not a draft; validate drafts only.")
	if not seller_has_token(doc.seller__business_name, doc.fbr_environment):
		raise ToolError(
			f"{doc.seller__business_name} has no {doc.fbr_environment.lower()} token saved, so FBR cannot validate "
			"this draft. The draft is still saved; tell the user."
		)
	from di.digital_invoicing.doctype.di_log.di_log import create_log
	from di.integrations.di_api import _is_valid_response, _make_request
	from di.integrations.http import FBRError
	from di.integrations.sale_tax_invoice_api import (
		_get_seller_token,
		_get_validate_url,
		build_sale_tax_invoice_payload,
	)
	from di.sandbox_drafts import format_fbr_validation_errors

	payload = build_sale_tax_invoice_payload(doc)
	try:
		response = _make_request(
			_get_validate_url(doc),
			payload,
			_get_seller_token(doc),
			context=f"validate {doc.name} (AI)",
			timeout=VALIDATE_TIMEOUT,
		)
	except FBRError as exc:
		create_log(
			doc.doctype,
			doc.name,
			payload,
			cstr(exc),
			status="Error",
			api_type="DI Validate",
			title=f"Sale Tax Invoice Validate Error: {doc.name}",
		)
		frappe.db.commit()
		raise ToolError(f"FBR validate failed: {rules.clip(cstr(exc), 400)}")
	valid = _is_valid_response(response)
	errors = "" if valid else format_fbr_validation_errors(response)
	vr = (response or {}).get("validationResponse") or {}
	codes = sorted(
		{cstr(s.get("errorCode")) for s in (vr.get("invoiceStatuses") or []) if s.get("errorCode")}
		| ({cstr(vr.get("errorCode"))} if vr.get("errorCode") else set())
	)
	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Success" if valid else "Error",
		api_type="DI Validate",
		title=f"Sale Tax Invoice Validate: {doc.name}",
		error_code=codes[0] if codes else "",
		error_message=errors,
	)
	frappe.db.commit()
	return {
		"ok": True,
		"name": doc.name,
		"environment": doc.fbr_environment,
		"valid": valid,
		"status": cstr(vr.get("status") or ("Valid" if valid else "Invalid")),
		"errors": errors,
		"error_codes": codes,
		"hints": {code: rules.FBR_ERROR_HINTS[code] for code in codes if code in rules.FBR_ERROR_HINTS},
		"note": "Validate only checks the draft. Nothing was filed.",
	}


# ---------------------------------------------------------------------------
# catalogue


def _schema(properties, required=None, description=None):
	schema = {
		"type": "object",
		"properties": properties,
		"required": list(properties.keys()) if required is None else required,
		"additionalProperties": False,
	}
	if description:
		schema["description"] = description
	return schema


def _str(description, nullable=False):
	return {"type": ["string", "null"] if nullable else "string", "description": description}


def _num(description, nullable=False):
	return {"type": ["number", "null"] if nullable else "number", "description": description}


_ITEM_SCHEMA = _schema(
	{
		"tax_item": _str("Exact Tax Item name from search_tax_items or create_tax_item."),
		"quantity": _num("Quantity, greater than 0."),
		"sale_rate": _num("Unit price in PKR excluding sales tax, greater than 0."),
		"discount": _num("Line discount in PKR, or null.", nullable=True),
		"sale_type": _str("FBR sale type; null to take it from the Tax Item.", nullable=True),
		"sro_schedule_no": _str("Exact SRO Schedule name from lookup_sro_schedules, or null.", nullable=True),
		"sro_item_serial_no": _str("Serial from lookup_sro_serials, or null.", nullable=True),
		"fixed_notified_value_or_retail_price": _num(
			"Printed retail price (MRP) per unit for 3rd Schedule / SRO 297 goods, or null.", nullable=True
		),
	}
)

TOOLS = {
	"search_buyers": (
		search_buyers,
		"Find existing buyers of a seller (and shared walk-in buyers) by name or NTN/CNIC. Call before creating a buyer.",
		_schema(
			{
				"seller": _str("Seller / Company name from CONTEXT."),
				"query": _str("Part of the name or the NTN/CNIC; empty lists recent buyers."),
			}
		),
	),
	"check_buyer_registration": (
		check_buyer_registration,
		"Ask FBR whether an NTN/CNIC is registered for sales tax (needs the seller's production token). Use before create_buyer instead of asking the user.",
		_schema(
			{
				"ntn_cnic": _str("NTN (7 digits or 1234567-8) or CNIC (13 digits)."),
				"seller": _str("Seller / Company name."),
			}
		),
	),
	"create_buyer": (
		create_buyer,
		"Create a buyer for a seller. Only when search_buyers found nothing and the user gave all details.",
		_schema(
			{
				"seller": _str("Seller / Company name."),
				"name": _str("Buyer business name."),
				"registration_type": _str(
					"'Registered' or 'Unregistered' (from check_buyer_registration when possible)."
				),
				"ntn_cnic": _str("NTN (7 digits, or 1234567-8) or CNIC (13 digits) given by the user."),
				"province": _str(
					"Pakistani province, e.g. PUNJAB, SINDH, KHYBER PAKHTUNKHWA, CAPITAL TERRITORY."
				),
				"address": _str("Postal address."),
			}
		),
	),
	"search_tax_items": (
		search_tax_items,
		"Find a seller's existing Tax Items (products/services with HS code, UOM and rate). Call before creating one.",
		_schema(
			{
				"seller": _str("Seller / Company name."),
				"query": _str("Words from the item name or an HS code; empty lists recent items."),
			}
		),
	),
	"search_hs_codes": (
		search_hs_codes,
		"Search the FBR HS code master by words or by a numeric prefix (e.g. '8421'). Try several phrasings.",
		_schema(
			{
				"query": _str("Search words or code prefix."),
				"limit": _num("Max results, up to 25.", nullable=True),
			}
		),
	),
	"get_hs_code": (
		get_hs_code,
		"Fetch one HS code to verify it exists and see its description and FBR UOM.",
		_schema({"hs_code": _str("Code in NNNN.NNNN form (8 bare digits are accepted).")}),
	),
	"lookup_fbr_uom": (
		lookup_fbr_uom,
		"Ask FBR which UOMs are allowed for an HS code (uses the seller's token). Use before create_tax_item.",
		_schema({"hs_code": _str("Code in NNNN.NNNN form."), "seller": _str("Seller / Company name.")}),
	),
	"lookup_fbr_rate": (
		lookup_fbr_rate,
		"Ask FBR for the tax rate(s) of a sale type for this seller's province; returns rate_id, tax_desc and rate_in_p.",
		_schema(
			{
				"hs_code": _str("HS code the item will use."),
				"uom": _str("UOM the item will use; helps pick between rates."),
				"sale_type": _str(
					"FBR sale type name, e.g. 'Goods at standard rate (default)', 'Goods at Reduced Rate'."
				),
				"seller": _str("Seller / Company name."),
				"date": _str("YYYY-MM-DD, or null for today.", nullable=True),
			}
		),
	),
	"lookup_sro_schedules": (
		lookup_sro_schedules,
		"SRO schedules FBR accepts for a rate_id (needed when the rate is not 18%).",
		_schema({"rate_id": _num("rate_id from lookup_fbr_rate."), "seller": _str("Seller / Company name.")}),
	),
	"lookup_sro_serials": (
		lookup_sro_serials,
		"Item serial numbers FBR accepts under one SRO schedule.",
		_schema(
			{"sro_id": _num("sro_id from lookup_sro_schedules."), "seller": _str("Seller / Company name.")}
		),
	),
	"create_tax_item": (
		create_tax_item,
		"Create a Tax Item (product/service) for a seller with a verified HS code, FBR UOM and tax rate. Only after the user picked the HS code.",
		_schema(
			{
				"seller": _str("Seller / Company name."),
				"description": _str("Item name as it should print on the invoice (max 140 chars)."),
				"hs_code": _str("Verified HS code."),
				"uom": _str("A UOM FBR allows for this HS code (from lookup_fbr_uom)."),
				"tax_desc": _str("Rate text, e.g. '18%', 'Exempt', '0%', or an FBR literal."),
				"rate_in_p": _num("Rate as a number, e.g. 18."),
				"sale_type": _str(
					"FBR sale type; null only for plain 18% standard-rate or 'Exempt' items.", nullable=True
				),
				"fixed_rs": _num(
					"Printed retail price per unit for 3rd Schedule goods, or null.", nullable=True
				),
				"rate_id": _num("rate_id from lookup_fbr_rate, or null.", nullable=True),
			}
		),
	),
	"update_tax_item": (
		update_tax_item,
		"Fix an existing Tax Item (UOM, HS code, rate, sale type). Drafts that use it take the change when saved again.",
		_schema(
			{
				"name": _str("Exact Tax Item name."),
				"uom": _str("New FBR UOM, or null to keep.", nullable=True),
				"hs_code": _str("New HS code, or null to keep.", nullable=True),
				"tax_desc": _str("New rate text, or null to keep.", nullable=True),
				"rate_in_p": _num("New rate number, or null to keep.", nullable=True),
				"sale_type": _str("New FBR sale type, or null to keep.", nullable=True),
				"rate_id": _num("rate_id from lookup_fbr_rate, or null to keep.", nullable=True),
				"fixed_rs": _num("Retail price per unit, or null to keep.", nullable=True),
			}
		),
	),
	"list_recent_invoices": (
		list_recent_invoices,
		"Recent SUBMITTED invoices of a seller (optionally for one buyer), with their lines. Use for 'same as last time'.",
		_schema(
			{
				"seller": _str("Seller / Company name."),
				"buyer": _str("Buyer name, or null for any buyer.", nullable=True),
				"limit": _num("How many, up to 10.", nullable=True),
			}
		),
	),
	"get_invoice": (
		get_invoice,
		"Read one Sale Tax Invoice with its lines, totals, FBR status and warnings.",
		_schema({"name": _str("Invoice name, e.g. STI-0331.")}),
	),
	"create_draft_invoice": (
		create_draft_invoice,
		"Create a DRAFT Sale Tax Invoice. It is never submitted; the user reviews and submits it. Report the environment the result shows.",
		_schema(
			{
				"seller": _str("Seller / Company name."),
				"buyer": _str("Exact Buyer name."),
				"items": {"type": "array", "items": _ITEM_SCHEMA, "description": "Invoice lines."},
				"environment": _str(
					"'Sandbox' or 'Production'; null for the default. Panel users: Production only.",
					nullable=True,
				),
				"invoice_date": _str("YYYY-MM-DD, or null for today.", nullable=True),
				"scenario_id": _str(
					"FBR scenario such as SN001; null to derive it from the sale type and buyer.",
					nullable=True,
				),
			}
		),
	),
	"update_draft_invoice": (
		update_draft_invoice,
		"Change a DRAFT invoice: header fields and/or replace all its lines (send every line, not just the changed one).",
		_schema(
			{
				"name": _str("Invoice name."),
				"set": _schema(
					{
						"buyer": _str("New buyer, or null.", nullable=True),
						"invoice_date": _str("New date, or null.", nullable=True),
						"fbr_environment": _str("'Sandbox' or 'Production', or null.", nullable=True),
						"scenario_id": _str("Scenario, or null to derive.", nullable=True),
					},
					description="Header changes; every key present, null to leave unchanged.",
				),
				"items": {
					"type": ["array", "null"],
					"items": _ITEM_SCHEMA,
					"description": "Full replacement list of lines, or null to keep the current lines.",
				},
			}
		),
	),
	"preview_fbr_payload": (
		preview_fbr_payload,
		"Show the JSON that would be sent to FBR for an invoice. No network call.",
		_schema({"name": _str("Invoice name.")}),
	),
	"validate_with_fbr": (
		validate_with_fbr,
		"Ask FBR to validate a DRAFT. Only checks; never files. Returns explained errors and the next step per error code.",
		_schema({"name": _str("Invoice name.")}),
	),
}

_FBR_TOOLS = {
	"lookup_fbr_uom",
	"lookup_fbr_rate",
	"lookup_sro_schedules",
	"lookup_sro_serials",
	"check_buyer_registration",
}


def tool_definitions(settings=None) -> list[dict]:
	definitions = []
	for name, (_func, description, parameters) in TOOLS.items():
		if settings is not None:
			if name in _FBR_TOOLS and not settings.allow_fbr_lookups:
				continue
			if name == "validate_with_fbr" and not settings.allow_fbr_validate:
				continue
		definitions.append(
			{
				"type": "function",
				"name": name,
				"description": description,
				"parameters": parameters,
				"strict": True,
			}
		)
	return definitions


_TRIM_KEEP = (
	"ok",
	"created",
	"updated",
	"valid",
	"name",
	"environment",
	"error",
	"note",
	"hint",
	"error_codes",
)
_INVOICE_HEADER = (
	"name",
	"status",
	"seller",
	"buyer",
	"environment",
	"invoice_date",
	"scenario_id",
	"fbr_invoice_no",
	"total_excl_tax",
	"total_tax",
	"grand_total",
	"url",
)


def _trim(value, limit=RESULT_CHARS):
	"""Keep a tool result under `limit` characters of JSON.

	The small facts the assistant itself reads back (ok, the draft's name and
	environment) survive the cut; the rest becomes clipped text the model can still read.
	"""
	text = json.dumps(value, default=str, ensure_ascii=False)
	if len(text) <= limit:
		return value
	if not isinstance(value, dict):
		return {"ok": True, "truncated": True, "text": text[:limit]}
	compact = {key: value[key] for key in _TRIM_KEEP if key in value}
	invoice = value.get("invoice")
	if isinstance(invoice, dict):
		compact["invoice"] = {key: invoice[key] for key in _INVOICE_HEADER if key in invoice}
		compact["invoice"]["items_count"] = len(invoice.get("items") or [])
	compact["truncated"] = True
	compact["text"] = text[:limit]
	# JSON-escaping the clipped text makes it longer again; shrink until the whole result fits.
	while compact["text"] and len(json.dumps(compact, default=str, ensure_ascii=False)) > limit:
		compact["text"] = compact["text"][: max(0, int(len(compact["text"]) * 0.9) - 50)]
	return compact


def run_tool(name, arguments, settings=None) -> dict:
	"""Dispatch one call. Never raises: the model gets {"ok": false, "error": ...}."""
	entry = TOOLS.get(name)
	if not entry:
		return {"ok": False, "error": f"Unknown tool {name!r}."}
	func, _description, parameters = entry
	# Resolve by name at call time so a patched module attribute (tests) is honoured.
	func = globals().get(func.__name__, func)
	kwargs = {}
	for key in parameters["properties"]:
		if key in (arguments or {}):
			kwargs[key] = arguments[key]
	# A one-seller user never has to say, and never gets to say, which company.
	if "seller" in parameters["properties"]:
		single = fixed_seller()
		if single:
			kwargs["seller"] = single
	started = time.monotonic()
	try:
		result = _trim(func(settings=settings, **kwargs))
	except ToolError as exc:
		frappe.db.rollback()
		result = {"ok": False, "error": str(exc)}
	except frappe.ValidationError as exc:
		frappe.db.rollback()
		result = {"ok": False, "error": rules.clip(cstr(exc), 400)}
	except Exception:
		frappe.db.rollback()
		log = frappe.log_error(frappe.get_traceback(), f"DI AI tool {name} failed")
		reference = getattr(log, "name", "") or ""
		result = {
			"ok": False,
			"error": f"Internal error in {name}; it was logged{f' as {reference}' if reference else ''}. Tell the user and stop retrying.",
		}
	if isinstance(result, dict):
		result.setdefault("duration_ms", int((time.monotonic() - started) * 1000))
	return result
