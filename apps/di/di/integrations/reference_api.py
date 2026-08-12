"""FBR Reference Data API integration.

Syncs reference data (provinces, HS codes, UOMs, transaction types,
SRO schedules, sale type rates) from FBR's PDI API endpoints.
"""

import frappe
import requests
from frappe import _
from frappe.utils import cstr, getdate, nowdate

from di.constants import REF_BASE_V1, REF_BASE_V2
from di.digital_invoicing.doctype.di_log.di_log import create_log


@frappe.whitelist()
def sync_provinces(company=None):
	"""Sync provinces from FBR API."""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/provinces"
	data = _make_get_request(url, token, "provinces")

	count = 0
	for item in data:
		province_code = item.get("stateProvinceCode")
		province_name = item.get("stateProvinceDesc")
		if not province_name:
			continue

		if frappe.db.exists("Province", province_name):
			doc = frappe.get_doc("Province", province_name)
			doc.province_code = province_code
			doc.save(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "Province",
					"province_name": province_name,
					"province_code": province_code,
				}
			).insert(ignore_permissions=True)
		count += 1

	return {"message": _("{0} provinces synced").format(count)}


@frappe.whitelist()
def sync_hs_codes(company=None):
	"""Sync HS codes from FBR API.

	UOM master data is synchronized through the dedicated UOM endpoint, so the
	HS code sync only updates the code and description.
	"""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/itemdesccode"
	data = _make_get_request(url, token, "HS codes")

	count = 0
	for item in data:
		hs_code = cstr(item.get("hS_CODE") or "").strip()
		if not hs_code:
			continue

		description = item.get("description") or ""

		if frappe.db.exists("HS Code", hs_code):
			doc = frappe.get_doc("HS Code", hs_code)
			doc.description = description
			doc.save(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "HS Code",
					"hs_code": hs_code,
					"description": description,
				}
			).insert(ignore_permissions=True)
		count += 1

	return {"message": _("{0} HS codes synced").format(count)}


@frappe.whitelist()
def sync_hs_code_uoms(company=None):
	"""Sync HS codes UOMs from FBR API."""
	if not company:
		company = frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("No company specified for HS Code UOM sync"))

	token = _get_token(company)
	di_settings = frappe.get_doc("DI Settings", company)
	if not di_settings.annexure_id:
		frappe.throw(_("Sales Annexure ID is required in DI Settings before syncing HS Code UOMs."))

	for hs_code in frappe.get_list("HS Code", pluck="name"):
		url = f"{REF_BASE_V2}/HS_UOM"
		data = _make_get_request(
			url,
			token,
			"HS Code Uoms",
			params={"hs_code": hs_code, "annexure_id": di_settings.annexure_id},
		)
		for item in data:
			uom = _row_value(item, "description")
			if not uom:
				continue
			_ensure_hs_uom(uom, _row_value(item, "uoM_ID", "uom_id"))
			doc = frappe.get_doc("HS Code", hs_code)
			doc.uom = uom
			doc.save(ignore_permissions=True)

	return {"message": _("HS Code UOMs synced")}


@frappe.whitelist()
def sync_uoms(company=None):
	"""Sync UOMs from FBR API."""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/uom"
	data = _make_get_request(url, token, "UOMs")

	count = 0
	for item in data:
		uom = _row_value(item, "description")
		if not uom:
			continue
		_ensure_hs_uom(uom, _row_value(item, "uoM_ID", "uom_id"))
		count += 1

	return {"message": _("{0} UOMs synced").format(count)}


@frappe.whitelist()
def sync_transaction_types(company=None):
	"""Sync transaction types from FBR API."""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/transtypecode"
	data = _make_get_request(url, token, "transaction types")

	count = 0
	for item in data:
		type_id = item.get("transactioN_TYPE_ID")
		desc = cstr(item.get("transactioN_DESC") or "").strip()
		if not desc:
			continue

		existing = frappe.db.exists("Transaction Type", desc) or frappe.db.get_value(
			"Transaction Type", {"transaction_desc": desc}, "name"
		)
		if existing:
			doc = frappe.get_doc("Transaction Type", existing)
			doc.transaction_type_id = type_id
			doc.save(ignore_permissions=True)
		else:
			try:
				frappe.get_doc(
					{
						"doctype": "Transaction Type",
						"transaction_desc": desc,
						"transaction_type_id": type_id,
					}
				).insert(ignore_permissions=True)
			except frappe.DuplicateEntryError:
				existing = frappe.db.get_value("Transaction Type", {"transaction_desc": desc}, "name") or desc
				doc = frappe.get_doc("Transaction Type", existing)
				doc.transaction_type_id = type_id
				doc.save(ignore_permissions=True)
		_sync_sale_type(desc)
		count += 1

	return {"message": _("{0} transaction types synced").format(count)}


@frappe.whitelist()
def sync_sro_item_codes(company=None):
	"""Sync SRO item codes from FBR API."""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/sroitemcode"
	data = _make_get_request(url, token, "SRO item codes")

	count = 0
	for item in data:
		sro_item_id = item.get("srO_ITEM_ID")
		sro_item_desc = item.get("srO_ITEM_DESC") or ""

		existing = frappe.db.exists("SRO Item", {"sro_item_id": sro_item_id})
		if existing:
			doc = frappe.get_doc("SRO Item", existing)
			doc.sro_item_desc = sro_item_desc
			doc.save(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "SRO Item",
					"sro_item_id": sro_item_id,
					"sro_item_desc": sro_item_desc,
				}
			).insert(ignore_permissions=True)
		count += 1

	return {"message": _("{0} SRO item codes synced").format(count)}


@frappe.whitelist()
def sync_sro_schedules(rate_id=None, date=None, origination_supplier=None, company=None):
	"""Sync SRO schedules from FBR API."""
	token = _get_token(company)
	url = f"{REF_BASE_V1}/SroSchedule"

	params = {"date": _format_reference_date(date)}
	if rate_id:
		params["rate_id"] = rate_id
	if not origination_supplier:
		origination_supplier = _get_company_province_code(company)
	if origination_supplier:
		params["origination_supplier_csv"] = origination_supplier

	data = _make_get_request(url, token, "SRO schedules", params=params)

	count = 0
	for item in data:
		sro_id = _row_value(item, "srO_ID", "sro_id", "sroId", "id")
		sro_desc = _row_value(item, "srO_DESC", "sro_desc", "sroDesc", "description")
		if not sro_desc:
			continue

		if frappe.db.exists("SRO Schedule", sro_desc):
			doc = frappe.get_doc("SRO Schedule", sro_desc)
			doc.sro_id = sro_id
			doc.save(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "SRO Schedule",
					"sro_desc": sro_desc,
					"sro_id": sro_id,
				}
			).insert(ignore_permissions=True)
		count += 1

	return {"message": _("{0} SRO schedules synced").format(count)}


@frappe.whitelist()
def sync_sale_type_rates(date=None, trans_type_id=None, origination_supplier=None, company=None):
	"""Sync sale type to rate mappings from FBR API v2."""
	data = get_sale_type_rates(date=date, trans_type_id=trans_type_id, origination_supplier=origination_supplier, company=company)
	return {"data": data, "message": _("{0} records received").format(len(data))}


def get_sale_type_rates(date=None, trans_type_id=None, origination_supplier=None, company=None):
	"""Fetch sale type rate rows from FBR API v2."""
	token = _get_token(company)
	url = f"{REF_BASE_V2}/SaleTypeToRate"

	params = {}
	params["date"] = _format_reference_date(date)
	if trans_type_id:
		params["transTypeId"] = trans_type_id
	if origination_supplier:
		params["originationSupplier"] = origination_supplier

	return _make_get_request(url, token, "sale type rates", params=params)


@frappe.whitelist()
def sync_sro_schedules_for_rates(date=None, company=None):
	"""Sync SRO schedules for all available transaction-type/rate combinations."""
	origin = _get_company_province_code(company)
	transaction_types = frappe.get_all(
		"Transaction Type",
		fields=["transaction_desc", "transaction_type_id"],
		filters={"transaction_type_id": [">", 0]},
		limit_page_length=0,
	)

	rates_checked = 0
	schedules_synced = 0
	errors = 0
	for transaction_type in transaction_types:
		try:
			rates = get_sale_type_rates(
				date=date,
				trans_type_id=transaction_type.transaction_type_id,
				origination_supplier=origin,
				company=company,
			)
		except Exception:
			errors += 1
			continue

		for rate in rates:
			rate_id = _row_value(rate, "ratE_ID", "rate_ID", "rate_id")
			if not rate_id:
				continue
			rates_checked += 1
			try:
				result = sync_sro_schedules(
					rate_id=rate_id,
					date=date,
					origination_supplier=origin,
					company=company,
				)
				schedules_synced += _extract_count(result.get("message"))
			except Exception:
				errors += 1

	return {
		"message": _("{0} rate rows checked, {1} SRO schedules synced, {2} errors").format(
			rates_checked, schedules_synced, errors
		)
	}


@frappe.whitelist()
def sync_all_reference_data(company=None):
	"""Sync API-backed reference data and local lookup rows used by the workspace."""
	from di.seed_data import seed_di_error_codes, seed_sandbox_scenarios_from_scenarios

	results = []
	for func in (
		sync_provinces,
		sync_hs_codes,
		sync_uoms,
		sync_hs_code_uoms,
		sync_transaction_types,
		sync_sro_item_codes,
		sync_sro_schedules_for_rates,
	):
		try:
			results.append(func(company=company))
		except Exception as exc:
			results.append({"message": _("{0} failed: {1}").format(func.__name__, str(exc))})

	results.append({"message": _("Sandbox scenarios seeded"), "result": seed_sandbox_scenarios_from_scenarios()})
	results.append({"message": _("DI error codes seeded"), "result": seed_di_error_codes()})

	return {"message": _("Reference data sync completed"), "results": results}


def _get_token(company=None):
	"""Get the DI bearer token from settings."""
	settings = _resolve_di_settings(company)
	if not settings:
		frappe.throw(_("DI Settings not found. Create DI Settings before syncing reference data."))

	return settings.get_password("access_token")


def _get_company_province_code(company=None):
	"""Resolve DI Settings province to the FBR province code expected by reference APIs."""
	settings = _resolve_di_settings(company)
	if not settings:
		frappe.throw(_("DI Settings not found. Create DI Settings before fetching FBR reference data."))

	province = settings.province or _get_seller_province(settings.company)
	if not province:
		frappe.throw(
			_("Province is required in DI Settings or Seller / Company for company {0}").format(
				settings.company
			)
		)

	province_code = frappe.db.get_value("Province", province, "province_code")
	if not province_code:
		frappe.throw(_("Province code was not found for {0}. Sync Provinces first.").format(province))

	return province_code


def _resolve_di_settings(company=None):
	"""Find the best DI Settings row for standalone reference lookups."""
	from di.digital_invoicing.doctype.di_settings.di_settings import get_settings

	candidates = []
	if company:
		candidates.append(company)

	default_company = frappe.defaults.get_global_default("company")
	if default_company and default_company not in candidates:
		candidates.append(default_company)

	for candidate in candidates:
		settings = get_settings(candidate)
		if settings:
			return settings

	settings_name = frappe.db.get_value(
		"DI Settings",
		{"enabled": 1},
		"name",
		order_by="modified desc",
	)
	if not settings_name:
		settings_name = frappe.db.get_value("DI Settings", {}, "name", order_by="modified desc")
	if not settings_name:
		return None

	return frappe.get_doc("DI Settings", settings_name)


def _get_seller_province(company):
	if not frappe.db.exists("DocType", "Seller Or Company"):
		return None

	if company:
		province = frappe.db.get_value("Seller Or Company", company, "seller_province")
		if province:
			return province

	return frappe.db.get_value(
		"Seller Or Company",
		{},
		"seller_province",
		order_by="modified desc",
	)


def _make_get_request(url, token, data_type, params=None):
	"""Make an authenticated GET request to the FBR reference API."""
	try:
		response = requests.get(
			url,
			params=params,
			headers={
				"Authorization": f"Bearer {token}",
				"Accept": "application/json",
			},
			timeout=30,
		)
	except requests.RequestException as e:
		create_log(
			"DI Settings",
			"",
			{"url": url, "params": params},
			str(e),
			status="Error",
			api_type="Reference",
			title=f"Reference Sync Error: {data_type}",
		)
		frappe.throw(_("FBR reference API request failed for {0}: {1}").format(data_type, str(e)))

	if response.status_code == 401:
		frappe.throw(_("FBR API returned 401 Unauthorized. Check your access token."))
	if response.status_code >= 400:
		frappe.throw(_("FBR reference API returned {0} for {1}").format(response.status_code, data_type))

	try:
		data = response.json()
	except ValueError:
		frappe.throw(_("Invalid JSON response from FBR for {0}").format(data_type))

	if isinstance(data, dict):
		for key in ("data", "result", "results", "items"):
			if key in data and isinstance(data[key], list):
				data = data[key]
				break
		else:
			data = [data]

	if not isinstance(data, list):
		data = [data] if data else []

	create_log(
		"DI Settings",
		"",
		{"url": url, "params": params},
		{"count": len(data)},
		status="Success",
		api_type="Reference",
		title=f"Reference Sync: {data_type}",
	)

	return data


def _ensure_hs_uom(uom, uom_id=None):
	"""Create or update an HS Uom row from FBR reference data."""
	if frappe.db.exists("HS Uom", uom):
		frappe.db.set_value(
			"HS Uom",
			uom,
			{"uom_id": uom_id, "uom_name": uom},
			update_modified=False,
		)
		return

	frappe.get_doc(
		{
			"doctype": "HS Uom",
			"uom_name": uom,
			"uom_id": uom_id,
		}
	).insert(ignore_permissions=True)


def _sync_sale_type(desc):
	"""Keep Sale Type master aligned with FBR transaction type descriptions."""
	if not frappe.db.exists("DocType", "Sale Type") or not desc:
		return

	from di.constants import SRO_REQUIRED_SALE_TYPES

	requires_sro = 1 if desc in SRO_REQUIRED_SALE_TYPES else 0
	if frappe.db.exists("Sale Type", desc):
		frappe.db.set_value("Sale Type", desc, "requires_sro", requires_sro, update_modified=False)
		return

	frappe.get_doc(
		{
			"doctype": "Sale Type",
			"sale_type_name": desc,
			"requires_sro": requires_sro,
		}
	).insert(ignore_permissions=True)


def _format_reference_date(value=None):
	"""Return the date format expected by FBR reference rate endpoints."""
	return getdate(value or nowdate()).strftime("%d-%b-%Y")


def _row_value(row, *keys):
	"""Read API rows despite FBR's inconsistent key casing."""
	if not isinstance(row, dict):
		return None

	for key in keys:
		if key in row and row.get(key) is not None:
			return row.get(key)

	normalised = {_normalise_key(key): value for key, value in row.items()}
	for key in keys:
		value = normalised.get(_normalise_key(key))
		if value is not None:
			return value

	return None


def _normalise_key(value):
	return "".join(ch for ch in cstr(value).lower() if ch.isalnum())


def _extract_count(message):
	if not message:
		return 0
	for token in cstr(message).split():
		if token.isdigit():
			return int(token)
	return 0
