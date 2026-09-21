"""Build and submit sandbox Sale Tax Invoices from a company's FBR token."""

from __future__ import annotations

import copy

import frappe
from frappe import _
from frappe.utils import cint, cstr, nowdate

from di.constants import DI_BASE_URL, DI_VALIDATE_PROD, DI_VALIDATE_SANDBOX
from di.fbr_scenarios import FBR_SCENARIOS
from di.integrations.http import FBRRejected, FBRUnsentError, get, post
from di.invoice_rules import (
	extra_rupees_per_qty,
	is_retryable_fbr_error,
	is_unassigned_scenario_error,
	row_needs_sro,
)

UNREGISTERED_SCENARIOS = {"SN002", "SN026", "SN027", "SN028"}
DEFAULT_QTY = 1
DEFAULT_RATE = 1000
FBR_SCENARIO_PATHS = (
	"/pdi/v1/scenariolist",
	"/di_data/v1/di/getscenarios",
	"/pdi/v2/scenariolist",
)

# sale type -> (tax_desc, rate_in_p, hs_code, uom, fixed_rs)
ITEM_DEFAULTS = {
	"Exempt goods": ("Exempt", 0, "4820.9000", "Numbers, pieces, units", 0),
	"Goods at zero-rate": ("0%", 0, "4820.9000", "Numbers, pieces, units", 0),
	"Goods at Reduced Rate": ("1%", 1, "4820.9000", "Numbers, pieces, units", 0),
	"Goods as per SRO.297(|)/2023": ("25%", 25, "4820.9000", "Numbers, pieces, units", 1000),
	"Services": ("16%", 16, "9801.5000", "Numbers, pieces, units", 0),
	"Services (FED in ST Mode)": ("16%", 16, "9801.5000", "Numbers, pieces, units", 0),
	# Finance Act 2026-27: FBR 0052 rejects paper/generic HS for this sale type.
	# Only white spirit / solvent oil / naphtha still match. The accepted rate
	# string moves; sandbox submit probes live petroleum rates before posting.
	"Goods (FED in ST Mode)": ("10.07%", 10.07, "2710.1240", "Liter", 0),
	"3rd Schedule Goods": ("18%", 18, "4820.9000", "Numbers, pieces, units", 1000),
	"Steel melting and re-rolling": ("18%", 18, "7214.2090", "MT", 0),
	"Toll Manufacturing": ("18%", 18, "7214.2090", "MT", 0),
	"Non-Adjustable Supplies": ("0%", 0, "3004.9099", "KG", 0),
}

# Working FBR sandbox recipes from live posts. Keys override item_defaults.
SCENARIO_RECIPES = {
	"SN003": {
		"hs_code": "7204.4990",
		"uom": "MT",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"sale_rate": 130000,
		"product_description": "IRON AND STEEL",
	},
	"SN004": {
		"hs_code": "7204.1010",
		"uom": "MT",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"sale_rate": 151842,
		"fixed_rs": 151842,
	},
	"SN010": {
		"hs_code": "9803.0000",
		"uom": "Numbers, pieces, units",
		"tax_desc": "17%",
		"rate_in_p": 17,
	},
	"SN012": {
		"hs_code": "2710.1210",
		"uom": "Liter",
		"tax_desc": "1.43%",
		"rate_in_p": 1.43,
		"product_description": "Petroleum Products",
		"sro_schedule": "1450(I)/2021",
		"sro_serial": "4",
		"qty": 123,
		"sale_rate": 100,
		"petroleum_levy": True,
	},
	"SN014": {
		"hs_code": "2711.2100",
		"uom": "MMBTU",
		"tax_desc": "18%",
		"rate_in_p": 18,
	},
	"SN013": {
		"hs_code": "2716.0000",
		"uom": "KWH",
		"tax_desc": "5%",
		"rate_in_p": 5,
	},
	"SN015": {
		"hs_code": "8517.1310",
		"uom": "Numbers, pieces, units",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"sro_schedule": "NINTH SCHEDULE",
		"sro_serial": "1(A)",
	},
	"SN020": {
		"hs_code": "8703.8090",
		"uom": "Numbers, pieces, units",
		"tax_desc": "1%",
		"rate_in_p": 1,
		"sro_schedule": "6th Schd Table III",
		"sro_serial": "20",
	},
	"SN021": {
		"hs_code": "2523.2900",
		"uom": "KG",
		"tax_desc": "Rs.2",
		"rate_in_p": 2,
		"sale_rate": 100,
	},
	"SN022": {
		"hs_code": "2829.1910",
		"uom": "KG",
		"tax_desc": "18% along with rupees 60 per kilogram",
		"rate_in_p": 18,
		"sro_schedule": "EIGHTH SCHEDULE Table 1",
		"sro_serial": "56",
	},
	"SN023": {
		"hs_code": "2711.2100",
		"uom": "KG",
		"tax_desc": "Rs.200",
		"rate_in_p": 200,
		"sale_rate": 100,
		"sro_schedule": "581(1)/2024",
		"sro_serial": "Region-I",
	},
	"SN011": {
		"hs_code": "7214.2090",
		"uom": "MT",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"sale_rate": 202455,
	},
	"SN025": {
		"hs_code": "3004.9099",
		"uom": "KG",
		"tax_desc": "0%",
		"rate_in_p": 0,
		"sro_schedule": "EIGHTH SCHEDULE Table 1",
		"sro_serial": "81",
	},
	"SN008": {
		"fixed_rs": 1000,
		"sale_rate": 1000,
	},
	"SN024": {
		"fixed_rs": 1000,
		"sale_rate": 1000,
	},
	"SN017": {
		"hs_code": "2710.1240",
		"uom": "Liter",
		"tax_desc": "10.07%",
		"rate_in_p": 10.07,
		"qty": 1,
		"sale_rate": 100,
	},
	"SN026": {"reuse": "SN001"},
	"SN027": {"reuse": "SN008"},
	"SN028": {
		"reuse": "SN005",
		"sro_schedule": "EIGHTH SCHEDULE Table 1",
		"sro_serial": "70",
	},
}

# Extra recipes tried only when FBR rejects the primary (EFS scrap, wrong rate).
SCENARIO_FALLBACKS = {
	"SN003": [
		{
			"hs_code": "7214.2090",
			"uom": "MT",
			"tax_desc": "18%",
			"rate_in_p": 18,
			"sale_rate": 202455,
			"product_description": "",
			"sro_schedule": "",
			"sro_serial": "",
		},
		{
			"hs_code": "7207.1210",
			"uom": "MT",
			"tax_desc": "18%",
			"rate_in_p": 18,
			"sale_rate": 172087,
			"product_description": "",
		},
	],
	"SN011": [
		{
			"hs_code": "7207.1210",
			"uom": "MT",
			"tax_desc": "18%",
			"rate_in_p": 18,
			"sale_rate": 172087,
		}
	],
	"SN025": [
		{
			"hs_code": "3004.1010",
			"uom": "Packs",
			"tax_desc": "0%",
			"rate_in_p": 0,
			"sro_schedule": "EIGHTH SCHEDULE Table 1",
			"sro_serial": "81",
		}
	],
	"SN017": [
		{
			"hs_code": "2710.1250",
			"uom": "Liter",
			"tax_desc": "8.19%",
			"rate_in_p": 8.19,
			"sale_rate": 100,
		},
		{
			"hs_code": "2710.1240",
			"uom": "Liter",
			"tax_desc": "9.08%",
			"rate_in_p": 9.08,
			"sale_rate": 100,
		},
		{
			"hs_code": "2710.1942",
			"uom": "Liter",
			"tax_desc": "8%",
			"rate_in_p": 8,
			"sale_rate": 100,
		},
		{
			"hs_code": "2710.1240",
			"uom": "Liter",
			"tax_desc": "18% and Rs. 80 per Liter",
			"rate_in_p": 18,
			"sale_rate": 100,
		},
		{
			"hs_code": "2710.1250",
			"uom": "Liter",
			"tax_desc": "18% and Rs. 80 per Liter",
			"rate_in_p": 18,
			"sale_rate": 100,
		},
		{
			"hs_code": "2710.1942",
			"uom": "Liter",
			"tax_desc": "18% and Rs. 80 per Liter",
			"rate_in_p": 18,
			"sale_rate": 100,
		},
	],
}

# HS codes FBR still maps to Goods (FED in ST Mode) after Budget 2026-27.
FED_ST_HS = (
	("2710.1240", "Liter"),
	("2710.1250", "Liter"),
	("2710.1942", "Liter"),
)
FED_ST_SEED_RATES = (
	("10.07%", 10.07),
	("9.08%", 9.08),
	("8.19%", 8.19),
	("8%", 8),
	("17%", 17),
	("18% and Rs. 80 per Liter", 18),
)


def recipe_for(sn_no: str, sale_type: str = "") -> dict:
	"""Sale-type defaults plus the scenario overrides that FBR actually accepted."""
	if not sale_type:
		sale_type = next((row[2] for row in FBR_SCENARIOS if row[0] == sn_no), "")
	tax_desc, rate_in_p, hs_code, uom, fixed_rs = item_defaults_for_sale_type(sale_type)
	recipe = {
		"qty": DEFAULT_QTY,
		"sale_rate": DEFAULT_RATE,
		"hs_code": hs_code,
		"uom": uom,
		"tax_desc": tax_desc,
		"rate_in_p": rate_in_p,
		"fixed_rs": fixed_rs,
		"product_description": "",
		"sro_schedule": "",
		"sro_serial": "",
		"reuse": "",
		"petroleum_levy": False,
	}
	overrides = SCENARIO_RECIPES.get(sn_no, {})
	recipe.update(overrides)
	if recipe["reuse"]:
		parent = recipe_for(recipe["reuse"])
		merged = dict(parent)
		for key, value in overrides.items():
			if key != "reuse":
				merged[key] = value
		merged["reuse"] = recipe["reuse"]
		return merged
	return recipe


def _recipe_key(recipe: dict) -> tuple:
	return (
		recipe.get("hs_code"),
		recipe.get("uom"),
		recipe.get("tax_desc"),
		recipe.get("sro_schedule"),
		recipe.get("sro_serial"),
	)


def recipes_for(sn_no: str, sale_type: str = "") -> list[dict]:
	"""Primary recipe plus sector fallbacks for EFS / wrong-rate rejections."""
	primary = recipe_for(sn_no, sale_type)
	out = [primary]
	seen = {_recipe_key(primary)}
	for extra in SCENARIO_FALLBACKS.get(sn_no, []):
		row = dict(primary)
		row.update(extra)
		key = _recipe_key(row)
		if key in seen:
			continue
		seen.add(key)
		out.append(row)
	return out


def fed_st_probe_candidates(company: str | None = None) -> list[tuple[str, str, str, float]]:
	"""Petroleum HS × rate strings to try for SN017 after Budget 2026-27."""
	rates: list[tuple[str, float]] = []
	seen = set()

	def add(desc, value):
		desc = cstr(desc).strip()
		if not desc or desc in seen:
			return
		seen.add(desc)
		try:
			val = float(value or 0)
		except (TypeError, ValueError):
			val = 0.0
		rates.append((desc, val))

	for desc, value in FED_ST_SEED_RATES:
		add(desc, value)
	if company:
		try:
			from di.integrations.reference_api import get_sale_type_rates

			for trans in ("Petroleum Products", "Goods (FED in ST Mode)"):
				tid = frappe.db.get_value("Transaction Type", trans, "transaction_type_id")
				if not tid:
					continue
				for row in get_sale_type_rates(trans_type_id=tid, company=company) or []:
					add(row.get("ratE_DESC") or row.get("rate_DESC"), row.get("ratE_VALUE") or row.get("rate_VALUE"))
		except Exception:
			pass
	return [(hs, uom, desc, val) for hs, uom in FED_ST_HS for desc, val in rates]


def buyer_kind_for_scenario(sn_no: str) -> str:
	return "Unregistered" if sn_no in UNREGISTERED_SCENARIOS else "Registered"


def item_defaults_for_sale_type(sale_type: str) -> tuple:
	return ITEM_DEFAULTS.get(
		sale_type, ("18%", 18, "4820.9000", "Numbers, pieces, units", 0)
	)


def _dummy_validate_payload():
	return {
		"invoiceType": "Sale Invoice",
		"invoiceDate": "2020-01-01",
		"sellerNTNCNIC": "0000000",
		"sellerBusinessName": "TOKEN PROBE",
		"sellerProvince": "PUNJAB",
		"sellerAddress": "Probe",
		"buyerNTNCNIC": "1000000000000",
		"buyerBusinessName": "Probe Buyer",
		"buyerRegistrationType": "Unregistered",
		"buyerProvince": "PUNJAB",
		"buyerAddress": "Probe",
		"invoiceRefNo": "",
		"items": [],
	}


def classify_token(token: str) -> str:
	"""Guess Sandbox / Production from a dummy validate call.

	A 400 on production is not proof of a production token. FBR often 401s a
	sandbox token on the dummy probe, then 400s the same token on production —
	that used to lock the picker with "This token is production."
	"""
	token = cstr(token).strip()
	if not token:
		return "Invalid"

	sandbox_hit = _probe(DI_BASE_URL + DI_VALIDATE_SANDBOX, token, "sandbox token probe")
	if sandbox_hit == "accepted":
		return "Sandbox"
	if sandbox_hit == "rejected":
		return "Sandbox"
	if sandbox_hit == "unauthorized":
		prod_hit = _probe(DI_BASE_URL + DI_VALIDATE_PROD, token, "production token probe")
		if prod_hit == "accepted":
			return "Production"
		if prod_hit == "unauthorized":
			return "Invalid"
		return "Unknown"
	return "Unknown"


def resolve_sandbox_environment(token: str, sync_mode: str) -> str:
	"""Honor Sync Mode. Dummy probes are too noisy to override Sandbox."""
	probed = classify_token(token)
	if probed == "Invalid":
		return "Invalid"
	if cstr(sync_mode) == "Sandbox":
		return "Sandbox"
	return probed


def _probe(url: str, token: str, context: str) -> str:
	try:
		post(url, token, _dummy_validate_payload(), context)
		return "accepted"
	except FBRRejected as exc:
		text = str(exc)
		if "401" in text or "Unauthorized" in text:
			return "unauthorized"
		return "rejected"
	except FBRUnsentError:
		return "unreachable"
	except Exception:
		return "unreachable"


def try_fetch_fbr_scenarios(token: str) -> list[str] | None:
	"""Best-effort. FBR does not document this; None means show the full list."""
	for path in FBR_SCENARIO_PATHS:
		try:
			body = get(DI_BASE_URL + path, token, "sandbox scenario list")
		except Exception:
			continue
		codes = _extract_scenario_codes(body)
		if codes:
			return codes
	return None


def _extract_scenario_codes(body) -> list[str]:
	codes = []
	rows = body
	if isinstance(body, dict):
		for key in ("scenarios", "data", "result", "items"):
			if isinstance(body.get(key), list):
				rows = body[key]
				break
		else:
			rows = [body]
	if not isinstance(rows, list):
		return []
	known = {row[0] for row in FBR_SCENARIOS}
	for row in rows:
		value = row
		if isinstance(row, dict):
			value = row.get("scenarioId") or row.get("scenario_id") or row.get("sn_no") or row.get("name")
		value = cstr(value).strip().upper()
		if value in known:
			codes.append(value)
	return list(dict.fromkeys(codes))


def list_sandbox_scenarios(company: str) -> dict:
	frappe.has_permission("DI Settings", "write", throw=True)
	settings = _get_settings(company)
	token = cstr(settings.get_password("access_token", raise_exception=False) or "").strip()
	if not token:
		frappe.throw(_("Paste the FBR access token on DI Settings first."))

	environment = resolve_sandbox_environment(token, settings.sync_mode)
	seller = _seller_name(settings)
	rows = []
	for sn_no, description, sale_type in FBR_SCENARIOS:
		status = _local_status(seller, sn_no)
		rows.append(
			{
				"scenario_id": sn_no,
				"description": description,
				"sale_type": sale_type,
				"status": status,
				"create_by_default": status in ("pending", "draft"),
			}
		)

	fbr_codes = try_fetch_fbr_scenarios(token) if environment == "Sandbox" else None
	if fbr_codes:
		pending = set(fbr_codes)
		for row in rows:
			if row["status"] == "posted":
				continue
			row["create_by_default"] = row["scenario_id"] in pending
			if row["scenario_id"] in pending:
				row["status"] = "pending"
			elif row["status"] == "pending":
				row["status"] = "not_assigned"

	return {
		"company": company,
		"seller": seller,
		"environment": environment,
		"fbr_list": bool(fbr_codes),
		"scenarios": rows,
		"message": _environment_message(environment, bool(fbr_codes)),
	}


def create_sandbox_drafts(company: str, scenario_ids: list[str] | None = None) -> dict:
	frappe.has_permission("DI Settings", "write", throw=True)
	settings = _get_settings(company)
	token = cstr(settings.get_password("access_token", raise_exception=False) or "").strip()
	if not token:
		frappe.throw(_("Paste the FBR access token on DI Settings first."))

	environment = resolve_sandbox_environment(token, settings.sync_mode)
	if environment == "Invalid":
		frappe.throw(_("FBR rejected this token. Check the Access Token on DI Settings."))
	if environment == "Production":
		frappe.throw(_("This token is a production token. Sandbox submit is only for a sandbox token."))

	from di.seed_data import seed_fbr_scenarios

	seed_fbr_scenarios()

	wanted = {cstr(code).strip().upper() for code in (scenario_ids or []) if cstr(code).strip()}
	if not wanted:
		frappe.throw(_("Select at least one scenario."))

	seller = _ensure_seller(settings, token)
	created = []
	skipped = []
	errors = []
	fbr_codes = try_fetch_fbr_scenarios(token)
	assigned = {cstr(code).upper() for code in fbr_codes} if fbr_codes else None

	for sn_no, description, sale_type in FBR_SCENARIOS:
		if sn_no not in wanted:
			continue
		if assigned is not None and sn_no not in assigned:
			skipped.append(
				{
					"scenario_id": sn_no,
					"reason": _("FBR did not assign this scenario to this token"),
				}
			)
			continue
		status = _local_status(seller, sn_no)
		if status == "posted":
			skipped.append({"scenario_id": sn_no, "reason": _("Already successful on this site")})
			continue
		try:
			doc = _submit_sandbox_invoice(seller, settings, sn_no, description, sale_type, company)
			created.append(
				{
					"scenario_id": sn_no,
					"name": doc.name,
					"fbr_invoice_no": cstr(doc.fbr_invoice_no),
				}
			)
			frappe.db.commit()
		except Exception as exc:
			frappe.db.rollback()
			if is_unassigned_scenario_error(str(exc)):
				skipped.append(
					{
						"scenario_id": sn_no,
						"reason": _("FBR did not assign this scenario to this token"),
					}
				)
				continue
			errors.append({"scenario_id": sn_no, "reason": str(exc)[:400]})
			frappe.log_error(frappe.get_traceback(), f"Sandbox submit {sn_no}")

	return {
		"seller": seller,
		"created": created,
		"skipped": skipped,
		"errors": errors,
	}


def _environment_message(environment: str, fbr_list: bool) -> str:
	if environment == "Production":
		return _("This token is production. Sandbox pending invoices do not apply.")
	if environment == "Invalid":
		return _("FBR rejected this token.")
	if environment == "Unknown":
		return _("Could not reach FBR. Showing all scenarios — tick the ones you still need.")
	if fbr_list:
		return _("FBR returned a scenario list. Uncheck any that are already done elsewhere.")
	return _("FBR did not return a pending list. Select the scenarios you still need, then validate and submit.")


def _get_settings(company: str):
	name = frappe.db.get_value("DI Settings", {"company": company}, "name")
	if not name:
		frappe.throw(_("Create DI Settings for {0} first.").format(company))
	return frappe.get_doc("DI Settings", name)


def _seller_name(settings) -> str:
	company = cstr(settings.company)
	if frappe.db.exists("Seller Or Company", company):
		return company
	ntn = cstr(settings.ntn_cnic)
	if ntn:
		found = frappe.db.get_value("Seller Or Company", {"seller_ntncnic": ntn}, "name")
		if found:
			return found
	return company


def _normalize_province(value: str) -> str:
	options = {
		"BALOCHISTAN",
		"AZAD JAMMU AND KASHMIR",
		"CAPITAL TERRITORY",
		"KHYBER PAKHTUNKHWA",
		"PUNJAB",
		"SINDH",
		"GILGIT BALTISTAN",
	}
	raw = cstr(value).strip()
	if raw.upper() in options:
		return raw.upper()
	aliases = {
		"PUNJAB": "PUNJAB",
		"SINDH": "SINDH",
		"KPK": "KHYBER PAKHTUNKHWA",
		"KHYBER PAKHTUNKHWA": "KHYBER PAKHTUNKHWA",
		"ISLAMABAD": "CAPITAL TERRITORY",
		"ICT": "CAPITAL TERRITORY",
		"AJK": "AZAD JAMMU AND KASHMIR",
		"GB": "GILGIT BALTISTAN",
	}
	return aliases.get(raw.upper(), "PUNJAB")


def _local_status(seller: str, sn_no: str) -> str:
	if not seller or not frappe.db.exists("Seller Or Company", seller):
		return "pending"
	name = frappe.db.get_value(
		"Sale Tax Invoice",
		{"seller__business_name": seller, "scenario_id": sn_no, "docstatus": 1},
		"name",
	)
	if name and cstr(frappe.db.get_value("Sale Tax Invoice", name, "fbr_invoice_no")):
		return "posted"
	if frappe.db.exists(
		"Sale Tax Invoice",
		{"seller__business_name": seller, "scenario_id": sn_no, "docstatus": 0},
	):
		return "draft"
	return "pending"


def _ensure_seller(settings, token: str) -> str:
	name = _seller_name(settings)
	province = _normalize_province(settings.province)
	address = cstr(settings.address) or "Pakistan"
	ntn = cstr(settings.ntn_cnic)

	if frappe.db.exists("Seller Or Company", name):
		seller = frappe.get_doc("Seller Or Company", name)
		dirty = False
		if not seller.seller_ntncnic and ntn:
			seller.seller_ntncnic = ntn
			dirty = True
		if not seller.get_password("sandbox_token", raise_exception=False) and token:
			seller.sandbox_token = token
			dirty = True
		if dirty:
			seller.save(ignore_permissions=True)
		return name

	seller = frappe.get_doc(
		{
			"doctype": "Seller Or Company",
			"seller__business_name": name,
			"seller_ntncnic": ntn,
			"seller_province": province,
			"seller_address": address,
			"sandbox_token": token,
		}
	)
	seller.insert(ignore_permissions=True)
	return name


def _ensure_buyer(seller: str, kind: str, settings) -> str:
	if kind == "Unregistered":
		label = "Walk-in Buyer (Unregistered)"
		if frappe.db.exists("Buyer", label):
			return label
		frappe.get_doc(
			{
				"doctype": "Buyer",
				"buyer_businessname": label,
				"buyer_registration_type": "Unregistered",
				"buyer_ntncnic": "3520298765431",
				"buyer_province": _normalize_province(settings.province),
				"buyer_address": "Sandbox test address",
			}
		).insert(ignore_permissions=True)
		return label

	label = f"Sandbox {kind} Buyer ({seller})"[:140]
	if frappe.db.exists("Buyer", label):
		return label

	candidates = frappe.get_all(
		"Buyer",
		filters={"buyer_registration_type": kind},
		fields=["name", "seller", "buyer_ntncnic", "buyer_province", "buyer_address"],
		limit=50,
	)
	for row in candidates:
		if row.seller == seller:
			return row.name

	province = _normalize_province(settings.province)
	seller_ntn = cstr(frappe.db.get_value("Seller Or Company", seller, "seller_ntncnic") or "")
	ntn = ""
	address = "Sandbox test address"
	source = next((row for row in candidates if not row.seller), None) or (candidates[0] if candidates else None)
	if source:
		ntn = cstr(source.buyer_ntncnic)
		province = _normalize_province(source.buyer_province) or province
		address = cstr(source.buyer_address) or address
	elif kind == "Unregistered":
		ntn = "3520298765431"
	else:
		ntn = "7654321"
		if ntn == seller_ntn:
			ntn = "7654322"

	frappe.get_doc(
		{
			"doctype": "Buyer",
			"seller": seller,
			"buyer_businessname": label,
			"buyer_registration_type": kind,
			"buyer_ntncnic": ntn,
			"buyer_province": province,
			"buyer_address": address,
		}
	).insert(ignore_permissions=True)
	return label


def _ensure_item(seller: str, sn_no: str, sale_type: str, recipe: dict | None = None) -> str:
	recipe = recipe or recipe_for(sn_no, sale_type)
	if recipe.get("reuse") and recipe["reuse"] != sn_no:
		parent_sale = next((row[2] for row in FBR_SCENARIOS if row[0] == recipe["reuse"]), sale_type)
		return _ensure_item(seller, recipe["reuse"], parent_sale)

	named = _sandbox_item_name(seller, sn_no, recipe)
	_ensure_hs_code(recipe["hs_code"], recipe["uom"])

	values = {
		"seller": seller,
		"hs_code": recipe["hs_code"],
		"product_uom": recipe["uom"],
		"tax_desc": recipe["tax_desc"],
		"rate_in_p": recipe["rate_in_p"],
		"fixed_rs": recipe.get("fixed_rs") or 0,
	}
	if sale_type and frappe.db.exists("Transaction Type", sale_type):
		values["transaction_type"] = sale_type

	if frappe.db.exists("Tax Item", named):
		item = frappe.get_doc("Tax Item", named)
		owner = cstr(item.get("seller") or "")
		if owner and owner != seller:
			named = f"{sn_no} {seller}"[:140]
			if frappe.db.exists("Tax Item", named):
				item = frappe.get_doc("Tax Item", named)
			else:
				values.update({"doctype": "Tax Item", "product_description": named})
				frappe.get_doc(values).insert(ignore_permissions=True)
				return named
		dirty = False
		for field, value in values.items():
			if item.get(field) != value:
				item.set(field, value)
				dirty = True
		if dirty:
			item.save(ignore_permissions=True)
		return named

	values.update(
		{
			"doctype": "Tax Item",
			"product_description": named,
		}
	)
	frappe.get_doc(values).insert(ignore_permissions=True)
	return named


def _sandbox_item_name(seller: str, sn_no: str, recipe: dict | None = None) -> str:
	"""Seller-scoped, but keep FBR's required words (Petroleum Products, IRON AND STEEL)."""
	wanted = cstr((recipe or {}).get("product_description") or "").strip()
	if wanted:
		return f"{wanted} ({seller})"[:140]
	return f"{sn_no} {seller}"[:140]


def _ensure_hs_code(hs_code: str, uom: str) -> None:
	if not hs_code:
		return
	if frappe.db.exists("HS Code", hs_code):
		if uom and not frappe.db.get_value("HS Code", hs_code, "uom"):
			try:
				frappe.db.set_value("HS Code", hs_code, "uom", uom, update_modified=False)
			except Exception:
				pass
		return
	try:
		frappe.get_doc(
			{
				"doctype": "HS Code",
				"hs_code": hs_code,
				"description": hs_code,
				"uom": uom if uom and frappe.db.exists("HS Uom", uom) else "",
			}
		).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), f"Sandbox HS {hs_code}")


def _find_template_item(sale_type: str, sn_no: str = ""):
	if sn_no:
		posted = frappe.get_all(
			"Sale Tax Invoice",
			filters={"scenario_id": sn_no, "docstatus": 1},
			fields=["name"],
			order_by="modified desc",
			limit=1,
		)
		if posted:
			item_name = frappe.db.get_value(
				"Sale Tax Invoice Item", {"parent": posted[0].name}, "description"
			)
			if item_name and frappe.db.exists("Tax Item", item_name):
				return frappe.get_doc("Tax Item", item_name)

	filters = {"transaction_type": sale_type}
	name = frappe.db.get_value("Tax Item", filters, "name")
	if name:
		return frappe.get_doc("Tax Item", name)
	return None


def _ensure_sro_schedule(desc: str) -> str:
	desc = cstr(desc).strip()
	if not desc:
		return ""
	if frappe.db.exists("SRO Schedule", desc):
		return desc
	try:
		frappe.get_doc({"doctype": "SRO Schedule", "sro_desc": desc}).insert(ignore_permissions=True)
	except Exception:
		if frappe.db.exists("SRO Schedule", desc):
			return desc
		frappe.log_error(frappe.get_traceback(), f"Sandbox SRO {desc}")
	return desc


def _sro_from_previous(sn_no: str) -> tuple[str, str]:
	posted = frappe.get_all(
		"Sale Tax Invoice",
		filters={"scenario_id": sn_no, "docstatus": 1},
		fields=["name"],
		order_by="modified desc",
		limit=1,
	)
	if not posted:
		return "", ""
	row = frappe.db.get_value(
		"Sale Tax Invoice Item",
		{"parent": posted[0].name},
		["sro_schedule_no", "sro_item_serial_no"],
		as_dict=True,
	)
	if not row:
		return "", ""
	return cstr(row.sro_schedule_no), cstr(row.sro_item_serial_no)


def _submit_sandbox_invoice(seller, settings, sn_no, description, sale_type, company):
	last_exc = None
	for recipe in recipes_for(sn_no, sale_type):
		try:
			return _submit_one(seller, settings, sn_no, description, sale_type, company, recipe)
		except Exception as exc:
			last_exc = exc
			if not is_retryable_fbr_error(str(exc)):
				raise
	if last_exc:
		raise last_exc
	frappe.throw(_("FBR did not accept any recipe for {0}.").format(sn_no))


def _submit_one(seller, settings, sn_no, description, sale_type, company, recipe):
	name = frappe.db.get_value(
		"Sale Tax Invoice",
		{"seller__business_name": seller, "scenario_id": sn_no, "docstatus": 0},
		"name",
	)
	if name:
		doc = frappe.get_doc("Sale Tax Invoice", name)
		_apply_recipe_to_doc(doc, seller, settings, sn_no, sale_type, recipe)
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(
			"Sale Tax Invoice",
			_create_draft(seller, settings, sn_no, description, sale_type, recipe),
		)

	_fill_sro_if_needed(doc, company)
	if sn_no == "SN017":
		_probe_and_post_fed_st(doc, seller, sale_type, company)
	try:
		doc.submit()
	except Exception:
		if not cstr(getattr(doc, "fbr_invoice_no", "")):
			_discard_draft(doc)
		raise
	if not cstr(doc.fbr_invoice_no):
		if cint(doc.docstatus) == 0:
			_discard_draft(doc)
		frappe.throw(_("FBR did not return an invoice number for {0}.").format(sn_no))
	doc.db_set("sandbox_run_status", "Already Successful", update_modified=False)
	return doc


def _probe_and_post_fed_st(doc, seller, sale_type, company):
	"""Validate petroleum HS/rate pairs, then post the first payload FBR accepts.

	After Budget 2026-27, SaleTypeToRate for this sale type and the validate
	whitelist disagree, and the accepted rate string moves. Probe first, post
	that exact payload, then pin the Tax Item so the ERP row matches.
	"""
	from di.integrations.di_api import _is_valid_response, _make_request, _round_currency
	from di.integrations.sale_tax_invoice_api import (
		_apply_success,
		_get_post_url,
		_get_seller_token,
		_get_validate_url,
		build_sale_tax_invoice_payload,
	)

	base = build_sale_tax_invoice_payload(doc)
	token = _get_seller_token(doc)
	validate_url = _get_validate_url(doc)
	post_url = _get_post_url(doc)
	qty = float(base["items"][0].get("quantity") or 1) or 1.0
	value = float(base["items"][0].get("valueSalesExcludingST") or 100) or 100.0

	for hs, uom, tax_desc, rate_in_p in fed_st_probe_candidates(company):
		sales_tax = value * float(rate_in_p) / 100 + float(extra_rupees_per_qty(tax_desc)) * qty
		payload = copy.deepcopy(base)
		payload["items"][0].update(
			{
				"hsCode": hs,
				"uoM": uom,
				"rate": tax_desc,
				"salesTaxApplicable": _round_currency(sales_tax),
				"valueSalesExcludingST": _round_currency(value),
				"totalValues": _round_currency(value + sales_tax),
			}
		)
		try:
			validated = _make_request(validate_url, payload, token)
		except Exception:
			continue
		if not _is_valid_response(validated):
			continue
		try:
			response = _make_request(post_url, payload, token)
		except Exception:
			continue
		invoice_number = cstr(response.get("invoiceNumber") or "").strip()
		if not invoice_number:
			continue
		_pin_fed_st_recipe(doc, seller, sale_type, hs, uom, tax_desc, rate_in_p, value / qty if qty else value)
		_apply_success(doc, payload, response, invoice_number)
		doc.db_set("fbr_invoice_no", invoice_number, update_modified=False)
		return invoice_number
	return None


def _pin_fed_st_recipe(doc, seller, sale_type, hs, uom, tax_desc, rate_in_p, sale_rate):
	recipe = recipe_for("SN017", sale_type)
	recipe.update(
		{
			"hs_code": hs,
			"uom": uom,
			"tax_desc": tax_desc,
			"rate_in_p": rate_in_p,
			"qty": 1,
			"sale_rate": sale_rate,
		}
	)
	item = _ensure_item(seller, "SN017", sale_type, recipe)
	if doc.invoice_items:
		row = doc.invoice_items[0]
		row.description = item
		row.quantity = 1
		row.sale_rate = sale_rate
		row.hs_code = hs
		row.uom = uom
		row.rate_in_percentage = tax_desc
		row.tax_rate_value = rate_in_p


def _apply_recipe_to_doc(doc, seller, settings, sn_no, sale_type, recipe=None):
	recipe = recipe or recipe_for(sn_no, sale_type)
	kind = buyer_kind_for_scenario(sn_no)
	doc.buyer = _ensure_buyer(seller, kind, settings)
	doc.seller__business_name = seller
	doc.fbr_environment = "Sandbox"
	item = _ensure_item(seller, sn_no, sale_type, recipe)
	sro_schedule = recipe.get("sro_schedule") or ""
	sro_serial = recipe.get("sro_serial") or ""
	if not sro_schedule:
		sro_schedule, sro_serial = _sro_from_previous(sn_no)
	sro_schedule = _ensure_sro_schedule(sro_schedule)
	if not doc.invoice_items:
		doc.append(
			"invoice_items",
			{
				"description": item,
				"quantity": recipe["qty"],
				"sale_rate": recipe["sale_rate"],
				"sale_type": sale_type,
				"sro_schedule_no": sro_schedule,
				"sro_item_serial_no": sro_serial,
				"fixed_notified_value_or_retail_price": recipe.get("fixed_rs") or 0,
			},
		)
		return
	row = doc.invoice_items[0]
	row.description = item
	row.quantity = recipe["qty"]
	row.sale_rate = recipe["sale_rate"]
	row.sale_type = sale_type
	row.sro_schedule_no = sro_schedule
	row.sro_item_serial_no = sro_serial
	row.fixed_notified_value_or_retail_price = recipe.get("fixed_rs") or 0


def _create_draft(seller: str, settings, sn_no: str, description: str, sale_type: str, recipe=None) -> str:
	recipe = recipe or recipe_for(sn_no, sale_type)
	kind = buyer_kind_for_scenario(sn_no)
	buyer = _ensure_buyer(seller, kind, settings)
	item = _ensure_item(seller, sn_no, sale_type, recipe)
	sro_schedule = recipe.get("sro_schedule") or ""
	sro_serial = recipe.get("sro_serial") or ""
	if not sro_schedule:
		sro_schedule, sro_serial = _sro_from_previous(sn_no)
	sro_schedule = _ensure_sro_schedule(sro_schedule)

	doc = frappe.get_doc(
		{
			"doctype": "Sale Tax Invoice",
			"invoice_type": "Sale Invoice",
			"invoice_date": nowdate(),
			"scenario_id": sn_no,
			"fbr_environment": "Sandbox",
			"buyer": buyer,
			"seller__business_name": seller,
			"sandbox_run_status": "Pending Review",
			"invoice_items": [
				{
					"description": item,
					"quantity": recipe["qty"],
					"sale_rate": recipe["sale_rate"],
					"sale_type": sale_type,
					"sro_schedule_no": sro_schedule,
					"sro_item_serial_no": sro_serial,
					"fixed_notified_value_or_retail_price": recipe.get("fixed_rs") or 0,
				}
			],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def format_fbr_validation_errors(response) -> str:
	"""Turn an FBR validate body into one line the draft picker can show."""
	vr = (response or {}).get("validationResponse") or {}
	parts = []
	if vr.get("error"):
		parts.append(cstr(vr.get("error")))
	for item in vr.get("invoiceStatuses") or []:
		if cstr(item.get("status")).lower() == "valid" or not item.get("error"):
			continue
		code = cstr(item.get("errorCode"))
		prefix = f"{code}: " if code else ""
		parts.append(f"Item {item.get('itemSNo', '?')} — {prefix}{item.get('error')}")
	if not parts:
		status = cstr(vr.get("status") or "Invalid")
		parts.append(f"FBR reported the invoice as {status}.")
	return " | ".join(parts)


def keep_if_fbr_valid(doc) -> tuple[bool, str]:
	"""Keep a sandbox draft only after FBR validate succeeds. Never posts."""
	from di.integrations.di_api import _is_valid_response
	from di.integrations.sale_tax_invoice_api import validate_sale_tax_invoice

	try:
		response = validate_sale_tax_invoice(doc)
	except Exception as exc:
		_discard_draft(doc)
		return False, cstr(exc)[:400]

	if _is_valid_response(response):
		doc.db_set("sandbox_run_status", "FBR Validated", update_modified=False)
		return True, ""

	reason = format_fbr_validation_errors(response)
	_discard_draft(doc)
	return False, reason[:400]


def _discard_draft(doc):
	name = getattr(doc, "name", None)
	if not name or not frappe.db.exists("Sale Tax Invoice", name):
		return
	if cint(frappe.db.get_value("Sale Tax Invoice", name, "docstatus")) != 0:
		return
	frappe.delete_doc("Sale Tax Invoice", name, ignore_permissions=True, force=True)


def _fill_sro_if_needed(doc, company=None):
	"""Fill SRO only for sale types FBR actually rejected without one."""
	from di.integrations.reference_api import get_sro_items_for_schedule, get_sro_schedules_for_rate

	recipe = recipe_for(doc.scenario_id) if doc.scenario_id in SCENARIO_RECIPES else {}
	if recipe and not recipe.get("sro_schedule"):
		needs_sro = any(
			row_needs_sro(row.tax_rate_value, row.sale_type, row.sro_schedule_no)
			for row in doc.get("invoice_items") or []
		)
		if not needs_sro:
			return

	dirty = False
	for row in doc.get("invoice_items") or []:
		if not row_needs_sro(row.tax_rate_value, row.sale_type, row.sro_schedule_no):
			continue
		rate_id = frappe.db.get_value("Tax Item", row.description, "rate_id") if row.description else None
		if not rate_id:
			continue
		try:
			schedules = get_sro_schedules_for_rate(rate_id, company=company)
		except Exception:
			continue
		if not schedules:
			continue
		chosen = schedules[0]
		serial = ""
		try:
			serials = get_sro_items_for_schedule(chosen.get("sro_id"), company=company)
			if serials:
				serial = serials[0].get("serial") or ""
		except Exception:
			serial = ""
		row.sro_schedule_no = _ensure_sro_schedule(chosen.get("sro_desc") or "")
		row.sro_item_serial_no = serial
		dirty = True
	if dirty:
		doc.save(ignore_permissions=True)
