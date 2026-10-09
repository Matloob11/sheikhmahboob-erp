"""FBR Digital Invoicing API integration (PRAL DI API v1.12).

Handles both postinvoicedata and validateinvoicedata endpoints.
"""

import json
from dataclasses import asdict, dataclass
from decimal import ROUND_HALF_UP, Decimal

import frappe
from frappe import _
from frappe.utils import flt, now

from di.constants import (
	DI_BASE_URL,
	DI_POST_PROD,
	DI_POST_SANDBOX,
	DI_VALIDATE_PROD,
	DI_VALIDATE_SANDBOX,
	INVOICE_TYPE_DEBIT_NOTE,
	INVOICE_TYPE_SALE,
)
from di.digital_invoicing.doctype.di_log.di_log import create_log


@dataclass
class Invoice:
	invoiceType: str
	invoiceDate: str
	sellerBusinessName: str
	sellerNTNCNIC: str
	sellerProvince: str
	sellerAddress: str
	buyerNTNCNIC: str
	buyerBusinessName: str
	buyerRegistrationType: str
	buyerProvince: str
	buyerAddress: str
	invoiceRefNo: str
	items: list


@dataclass
class InvoiceItem:
	discount: float
	fedPayable: float
	furtherTax: float
	hsCode: str
	extraTax: float
	productDescription: str
	quantity: float
	rate: str
	salesTaxApplicable: float
	salesTaxWithheldAtSource: float
	sroItemSerialNo: str
	sroScheduleNo: str
	totalValues: float
	uoM: str
	valueSalesExcludingST: float
	saleType: str
	fixedNotifiedValueOrRetailPrice: float


def _as_decimal(value) -> Decimal:
	if value in (None, ""):
		return Decimal("0")
	return Decimal(str(value))


def _round_currency(value) -> float:
	return float(_as_decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _is_fbr_rate_literal(rate_text: str) -> bool:
	text = (rate_text or "").strip()
	if not text:
		return False
	lower = text.lower()
	return text == "Exempt" or "rs" in lower or "rupee" in lower or "along with" in lower


def _format_rate(percentage, sale_type, rate_text=None) -> str:
	if sale_type == "Exempt goods":
		return "Exempt"
	if _is_fbr_rate_literal(rate_text or ""):
		return str(rate_text).strip()
	normalized = _as_decimal(percentage).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP).normalize()
	formatted = format(normalized, "f")
	if "." in formatted:
		formatted = formatted.rstrip("0").rstrip(".")
	return f"{formatted or '0'}%"


def _safe_str(value) -> str:
	return "" if value in (None, "") else str(value)


def post_invoice(doc, resync=False):
	"""Submit invoice to FBR DI API (postinvoicedata)."""
	settings = _get_settings(doc.company)
	if not settings:
		return
	if not resync and not settings.auto_post_on_submit:
		return
	# Mirror of the standalone fbr_invoice_no guard: an amended or duplicated
	# ERPNext invoice that still carries di_integration_id must not file again.
	if not resync and doc.get("di_integration_id"):
		return

	payload = build_di_payload(doc)
	url = _get_post_url(settings)
	token = settings.get_password("access_token")

	if settings.sync_mode == "Sandbox" and doc.get("di_scenario_id"):
		payload["scenarioId"] = doc.di_scenario_id

	from di.integrations.fbr_outcome import (
		persist_post_exception,
		persist_post_rejection,
		persist_post_success,
	)

	try:
		response = _make_request(url, payload, token, context=f"{doc.doctype} {doc.name}")
	except Exception as e:
		persist_post_exception(doc, payload, e)
		# Re-raise rather than collapsing into a generic throw. The type says
		# whether this may be sent again, and the retry job depends on knowing:
		# resending after a lost reply can file the same invoice with FBR twice.
		raise

	invoice_number = response.get("invoiceNumber")
	if invoice_number:
		persist_post_success(doc, payload, response, invoice_number, resync=resync)
	else:
		_error_code, error_msg = persist_post_rejection(doc, payload, response)
		frappe.throw(_("Digital Invoicing Error:\n{0}").format(error_msg))


def validate_invoice(doc):
	"""Validate invoice with FBR without posting (validateinvoicedata)."""
	from di.integrations.fbr_outcome import persist_validate_outcome

	settings = _get_settings(doc.company)
	if not settings:
		frappe.throw(_("DI Settings not found for company {0}").format(doc.company))

	payload = build_di_payload(doc)
	url = _get_validate_url(settings)
	token = settings.get_password("access_token")

	if settings.sync_mode == "Sandbox" and doc.get("di_scenario_id"):
		payload["scenarioId"] = doc.di_scenario_id

	try:
		response = _make_request(url, payload, token, context=f"validate {doc.doctype} {doc.name}")
	except Exception as e:
		persist_validate_outcome(doc, payload, exc=e)
		raise

	persist_validate_outcome(doc, payload, response=response)
	return response


def build_di_payload(doc):
	"""Build the DI API JSON payload from an ERPNext invoice document."""
	info = _get_configurations(
		doc.get("customer", default=None),
		doc.get("supplier", default=None),
		doc.company,
	)
	is_purchase = doc.doctype == "Purchase Invoice"

	invoice_type = INVOICE_TYPE_SALE
	invoice_ref_no = ""
	if doc.get("is_return") and doc.get("return_against"):
		invoice_type = INVOICE_TYPE_DEBIT_NOTE
		invoice_ref_no = frappe.db.get_value(doc.doctype, doc.return_against, "di_integration_id") or ""

	invoice = Invoice(
		# DI accepts only "Sale Invoice" and "Debit Note". The old code sent
		# "Purchase Invoice" for purchase documents, which FBR rejects outright.
		# A purchase is reported from the supplier's side — the payload below
		# already puts the supplier in the seller slot — so it is a sale
		# invoice, and a purchase return is a debit note just like a sales one.
		invoiceType=invoice_type,
		invoiceDate=(
			doc.posting_date.strftime("%Y-%m-%d")
			if hasattr(doc.posting_date, "strftime")
			else str(doc.posting_date)
		),
		sellerBusinessName=(
			info["supplier"]["business_name"] if is_purchase else info["company"]["business_name"]
		),
		sellerNTNCNIC=(info["supplier"]["ntncnic"] if is_purchase else info["company"]["ntncnic"]),
		sellerProvince=(info["supplier"]["province"] if is_purchase else info["company"]["province"]),
		sellerAddress=(info["supplier"]["address"] if is_purchase else info["company"]["address"]),
		buyerNTNCNIC=(info["customer"]["ntncnic"] if not is_purchase else info["company"]["ntncnic"]),
		buyerBusinessName=(
			info["customer"]["business_name"] if not is_purchase else info["company"]["business_name"]
		),
		buyerRegistrationType=(
			info["customer"].get("registration_type", "") if not is_purchase else "Registered"
		),
		buyerProvince=(info["customer"]["province"] if not is_purchase else info["company"]["province"]),
		buyerAddress=(info["customer"]["address"] if not is_purchase else info["company"]["address"]),
		invoiceRefNo=invoice_ref_no,
		items=_build_invoice_items(doc),
	)

	return asdict(invoice)


def _get_settings(company):
	from di.digital_invoicing.doctype.di_settings.di_settings import get_settings, is_enabled

	if not is_enabled(company):
		return None
	return get_settings(company)


def _get_post_url(settings):
	path = DI_POST_SANDBOX if settings.sync_mode == "Sandbox" else DI_POST_PROD
	return f"{DI_BASE_URL}{path}"


def _get_validate_url(settings):
	path = DI_VALIDATE_SANDBOX if settings.sync_mode == "Sandbox" else DI_VALIDATE_PROD
	return f"{DI_BASE_URL}{path}"


def _make_request(url, payload, token, context="invoice submission", timeout=None):
	from di.integrations.http import post

	return post(url, token, payload, context, timeout=timeout)


def _is_valid_response(response):
	vr = response.get("validationResponse", {})
	return vr.get("statusCode") == "00" and vr.get("status", "").lower() == "valid"


def _handle_success(doc, payload, response, invoice_number, resync):
	from di.integrations.fbr_outcome import persist_post_success

	return persist_post_success(doc, payload, response, invoice_number, resync=resync)


def _handle_error(doc, payload, response):
	from di.integrations.fbr_outcome import persist_post_rejection

	_error_code, error_msg = persist_post_rejection(doc, payload, response)
	frappe.throw(_("Digital Invoicing Error:\n{0}").format(error_msg))


def _get_configurations(customer, supplier, company):
	customer_doc = frappe.get_doc("Customer", customer) if customer else None
	supplier_doc = frappe.get_doc("Supplier", supplier) if supplier else None

	from di.digital_invoicing.doctype.di_settings.di_settings import get_settings

	settings = get_settings(company)

	company_doc = frappe.get_doc("Company", company)

	return {
		"customer": {
			"ntncnic": _safe_str(customer_doc.get("ntn_cnic")) if customer_doc else "",
			"business_name": _safe_str(customer_doc.get("customer_name")) if customer_doc else "",
			"registration_type": _safe_str(customer_doc.get("registration_type")) if customer_doc else "",
			"province": _safe_str(customer_doc.get("province")) if customer_doc else "",
			"address": _safe_str(customer_doc.get("di_address")) if customer_doc else "",
		}
		if customer_doc
		else {"ntncnic": "", "business_name": "", "registration_type": "", "province": "", "address": ""},
		"supplier": {
			"ntncnic": _safe_str(supplier_doc.get("tax_id")) if supplier_doc else "",
			"business_name": _safe_str(supplier_doc.get("supplier_name")) if supplier_doc else "",
			"registration_type": _safe_str(supplier_doc.get("registration_type")) if supplier_doc else "",
			"province": _safe_str(supplier_doc.get("province")) if supplier_doc else "",
			"address": _safe_str(supplier_doc.get("di_address")) if supplier_doc else "",
		}
		if supplier_doc
		else {"ntncnic": "", "business_name": "", "registration_type": "", "province": "", "address": ""},
		"company": {
			"ntncnic": _safe_str(settings.ntn_cnic if settings else company_doc.get("tax_id")),
			"business_name": _safe_str(company_doc.get("company_name")),
			"province": _safe_str(settings.province if settings else ""),
			"address": _safe_str(settings.address if settings else ""),
		},
	}


def _get_taxes(doc):
	"""Organize item-wise tax data keyed by di_tax_type.

	ERPNext 16 moved item-wise tax out of the `item_wise_tax_detail` JSON field
	on each tax row into an `item_wise_tax_details` child table on the parent,
	linked by child row *names* rather than item codes. Reading the old field on
	16 returns nothing, so every invoice was reported to FBR with zero sales tax
	while the invoice itself showed the tax correctly. Both layouts are handled
	here so the app works either side of that change.
	"""
	itemised_tax = {}
	tax_types = {row.name: (row.get("di_tax_type") or "") for row in doc.taxes}

	detail_rows = doc.get("item_wise_tax_details") or []
	if detail_rows:
		item_codes = {row.name: row.get("item_code") for row in doc.items}

		for row in detail_rows:
			tax_type_key = tax_types.get(row.tax_row)
			item_code = item_codes.get(row.item_row)
			if not tax_type_key or not item_code:
				continue

			bucket = itemised_tax.setdefault(item_code, {})
			entry = bucket.get(tax_type_key)
			if entry:
				entry["amount"] = flt(entry["amount"]) + flt(row.amount)
			else:
				bucket[tax_type_key] = {"percentage": flt(row.rate), "amount": flt(row.amount)}

		return itemised_tax

	for tax in doc.taxes:
		item_tax_map = json.loads(tax.get("item_wise_tax_detail") or "{}")
		if not item_tax_map:
			continue

		tax_type_key = tax.get("di_tax_type") or ""
		if not tax_type_key:
			continue

		for item_code, tax_data in item_tax_map.items():
			tax_rate = 0.0
			tax_amount = 0.0

			if isinstance(tax_data, list):
				tax_rate = flt(tax_data[0])
				tax_amount = flt(tax_data[1])
			else:
				tax_rate = flt(tax_data)

			if item_code not in itemised_tax:
				itemised_tax[item_code] = {}

			itemised_tax[item_code][tax_type_key] = {
				"percentage": tax_rate,
				"amount": tax_amount,
			}

	return itemised_tax


def _build_invoice_items(doc):
	"""Transform invoice line items to FBR DI format."""
	item_taxes = _get_taxes(doc)
	item_master_data = _get_item_master_di_fields(doc.items)
	invoice_items = []

	for line in doc.items:
		item_code = line.get("item_code")
		item_master = item_master_data.get(item_code, {})
		tax_data = item_taxes.get(item_code, {})
		gst = tax_data.get("Sales Tax", {"percentage": 0.0, "amount": 0.0})
		further_tax = tax_data.get("Further Tax", {"percentage": 0.0, "amount": 0.0})
		extra_tax = tax_data.get("Advance Tax", {"percentage": 0.0, "amount": 0.0})

		qty = flt(line.get("qty", 0))
		value_excl_st = _round_currency(line.get("net_amount", 0))

		# Prefer the amount ERPNext actually charged. Recomputing it from the
		# percentage drifts from the invoice total once discounts or rounding
		# are involved, and FBR rejects a mismatch (error 0104).
		if gst.get("amount"):
			sales_tax = _round_currency(gst["amount"])
		else:
			sales_tax = _round_currency(
				_as_decimal(value_excl_st) * _as_decimal(gst["percentage"]) / Decimal("100")
			)
		further_tax_amt = _round_currency(further_tax["amount"])
		extra_tax_amt = _round_currency(extra_tax["amount"])

		# FBR's fixed/notified value is the price it has notified for the goods,
		# used to validate tax on 3rd Schedule items. It is not derivable from
		# the sale: the old code sent net_amount / qty, i.e. the unit selling
		# rate, which fails validation whenever the two differ. Read the real
		# figure, and send 0 when none is set — FBR only requires it for the
		# sale types that carry a notified price.
		fixed_price = _round_currency(
			line.get("di_fixed_notified_value") or item_master.get("fixed_notified_value") or 0
		)

		total_values = _round_currency(
			_as_decimal(value_excl_st)
			+ _as_decimal(sales_tax)
			+ _as_decimal(further_tax_amt)
			+ _as_decimal(extra_tax_amt)
		)

		sale_type = line.get("di_sale_type") or item_master.get("sale_type") or ""

		invoice_item = InvoiceItem(
			discount=max(_round_currency(line.get("discount_amount", 0)), 0.0),
			fedPayable=_round_currency(line.get("di_fed_payable", 0)),
			furtherTax=further_tax_amt,
			hsCode=_safe_str(line.get("di_hs_code") or item_master.get("hs_code") or ""),
			extraTax=extra_tax_amt,
			productDescription=_safe_str(line.get("item_name", "")),
			quantity=round(qty, 4),
			rate=_format_rate(gst["percentage"], sale_type),
			salesTaxApplicable=sales_tax,
			salesTaxWithheldAtSource=0.0,
			sroItemSerialNo=_safe_str(
				line.get("di_sro_serial_no") or item_master.get("sro_item_serial_no") or ""
			),
			sroScheduleNo=_safe_str(
				line.get("di_schedule_no") or item_master.get("sro_schedule_no") or ""
			),
			totalValues=total_values,
			uoM=_safe_str(line.get("di_hs_uom") or item_master.get("hs_uom") or line.get("uom") or ""),
			valueSalesExcludingST=value_excl_st,
			saleType=sale_type,
			fixedNotifiedValueOrRetailPrice=fixed_price,
		)

		invoice_items.append(asdict(invoice_item))

	return invoice_items


def _get_item_master_di_fields(items):
	item_codes = sorted({line.get("item_code") for line in items if line.get("item_code")})
	if not item_codes:
		return {}

	return {
		row.name: row
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", item_codes]},
			fields=[
				"name",
				"hs_code",
				"hs_uom",
				"sale_type",
				"sro_item_serial_no",
				"sro_schedule_no",
				"fixed_notified_value",
			],
		)
	}
