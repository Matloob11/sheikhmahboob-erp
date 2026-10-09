"""Standalone Sale Tax Invoice integration for FBR DI.

This module is intentionally separate from the ERPNext Sales Invoice integration
because the standalone Hisab-style invoice uses Buyer, Seller Or Company, Tax
Item, and Scenario masters instead of ERPNext Company/Customer/Item records.
"""

from dataclasses import asdict

import frappe
from frappe import _
from frappe.utils import cstr, getdate, now

from di.constants import (
	DI_BASE_URL,
	DI_POST_PROD,
	DI_POST_SANDBOX,
	DI_VALIDATE_PROD,
	DI_VALIDATE_SANDBOX,
)
from di.digital_invoicing.doctype.di_log.di_log import create_log
from di.integrations.di_api import (
	Invoice,
	InvoiceItem,
	_format_rate,
	_is_valid_response,
	_make_request,
	_round_currency,
)
from di.invoice_rules import (
	fbr_buyer_business_name,
	fbr_product_description,
	petroleum_levy_on,
	settled_retail_price,
)


def post_sale_tax_invoice(doc, resync=False):
	"""Submit a standalone Sale Tax Invoice to FBR."""
	if not resync and doc.get("fbr_invoice_no"):
		return

	from di.integrations.fbr_outcome import (
		persist_post_exception,
		persist_post_rejection,
		persist_post_success,
	)

	payload = build_sale_tax_invoice_payload(doc)
	url = _get_post_url(doc)
	token = _get_seller_token(doc)

	try:
		response = _make_request(url, payload, token)
	except Exception as e:
		persist_post_exception(doc, payload, e)
		# Keep the error type: it says whether this may be sent again.
		raise

	invoice_number = cstr(response.get("invoiceNumber") or "").strip()
	if not invoice_number:
		_error_code, error_msg = persist_post_rejection(doc, payload, response)
		frappe.throw(_("Digital Invoicing Error:\n{0}").format(error_msg))

	persist_post_success(doc, payload, response, invoice_number, resync=resync)
	return response


def validate_sale_tax_invoice(doc):
	"""Validate a standalone Sale Tax Invoice with FBR without posting."""
	from di.integrations.fbr_outcome import persist_validate_outcome

	payload = build_sale_tax_invoice_payload(doc)
	url = _get_validate_url(doc)
	token = _get_seller_token(doc)

	try:
		response = _make_request(url, payload, token)
	except Exception as e:
		persist_validate_outcome(doc, payload, exc=e)
		raise

	persist_validate_outcome(doc, payload, response=response)
	return response


def build_sale_tax_invoice_payload(doc):
	"""Build FBR DI payload from the standalone Sale Tax Invoice document."""
	# Call these directly. Frappe 16 makes run_method() raise for names starting
	# with an underscore ("Run method is for hooks, avoid usage on internal
	# methods"), which broke every post and validate on this doctype.
	doc._sync_buyer_details()
	doc._sync_seller_details()
	doc._sync_item_details()
	doc._apply_scenario_sale_type()
	doc._ensure_third_schedule_prices()
	doc._calculate_totals()

	invoice_ref_no = ""
	if cstr(doc.get("invoice_type") or "") == "Debit Note" and doc.get("return_against"):
		invoice_ref_no = cstr(
			frappe.db.get_value("Sale Tax Invoice", doc.return_against, "fbr_invoice_no") or ""
		)

	invoice = Invoice(
		invoiceType=doc.invoice_type,
		invoiceDate=_format_date(doc.invoice_date),
		sellerBusinessName=cstr(doc.seller__business_name or ""),
		sellerNTNCNIC=cstr(doc.seller_ntncnic or ""),
		sellerProvince=cstr(doc.seller_province or ""),
		sellerAddress=cstr(doc.seller_address or ""),
		buyerNTNCNIC=cstr(doc.buyer_ntncnic or ""),
		buyerBusinessName=fbr_buyer_business_name(doc.buyer, doc.seller__business_name),
		buyerRegistrationType=cstr(doc.buyer_registration_type or ""),
		buyerProvince=cstr(doc.buyer_province or ""),
		buyerAddress=cstr(doc.buyer_address or ""),
		invoiceRefNo=invoice_ref_no,
		items=[_build_item_payload(row) for row in doc.get("invoice_items") or []],
	)
	payload = asdict(invoice)

	if _get_environment(doc) == "Sandbox" and doc.get("scenario_id"):
		payload["scenarioId"] = doc.scenario_id

	return payload


def _build_item_payload(row):
	sale_type = cstr(row.get("sale_type") or "")
	extra_tax = "" if sale_type == "Goods at Reduced Rate" else _round_currency(row.get("extra_tax", 0))

	payload = asdict(
		InvoiceItem(
			discount=_round_currency(row.get("discount", 0)),
			fedPayable=_round_currency(row.get("fed_payable", 0)),
			furtherTax=_round_currency(row.get("further_tax", 0)),
			hsCode=cstr(row.get("hs_code") or ""),
			extraTax=extra_tax,
			productDescription=fbr_product_description(row.get("description"), sale_type),
			quantity=round(float(row.get("quantity") or 0), 4),
			rate=_format_rate(row.get("tax_rate_value", 0), sale_type, row.get("rate_in_percentage")),
			salesTaxApplicable=_round_currency(row.get("sales_tax_applicable", 0)),
			salesTaxWithheldAtSource=_round_currency(row.get("sales_tax_withheld_at_source", 0)),
			sroItemSerialNo=cstr(row.get("sro_item_serial_no") or ""),
			sroScheduleNo=cstr(row.get("sro_schedule_no") or ""),
			totalValues=_round_currency(row.get("total_values", 0)),
			uoM=cstr(row.get("uom") or ""),
			valueSalesExcludingST=_round_currency(row.get("value_sales_excluding_st", 0)),
			saleType=sale_type,
			fixedNotifiedValueOrRetailPrice=_round_currency(
				settled_retail_price(
					sale_type,
					row.get("fixed_notified_value_or_retail_price"),
					row.get("sale_rate"),
				)
			),
		)
	)
	levy = petroleum_levy_on(sale_type, payload["quantity"])
	if levy is not None:
		payload["petroleumLevyOn"] = levy
	return payload


def _get_seller_token(doc):
	if not doc.get("seller__business_name"):
		frappe.throw(_("Seller / Business Name is required for FBR token selection."))

	token_field = "sandbox_token" if _get_environment(doc) == "Sandbox" else "production_token"
	# These are Password fields, so the table column only holds asterisks.
	# get_password reads the real value out of the auth table.
	seller = frappe.get_doc("Seller Or Company", doc.seller__business_name)
	token = cstr(seller.get_password(token_field, raise_exception=False) or "").strip()
	if not token:
		frappe.throw(
			_("{0} is missing on Seller Or Company {1}.").format(
				token_field.replace("_", " ").title(), doc.seller__business_name
			)
		)
	return token


def _get_environment(doc):
	return cstr(doc.get("fbr_environment") or "Sandbox").strip() or "Sandbox"


def _get_post_url(doc):
	path = DI_POST_SANDBOX if _get_environment(doc) == "Sandbox" else DI_POST_PROD
	return f"{DI_BASE_URL}{path}"


def _get_validate_url(doc):
	path = DI_VALIDATE_SANDBOX if _get_environment(doc) == "Sandbox" else DI_VALIDATE_PROD
	return f"{DI_BASE_URL}{path}"


def _format_date(value):
	if not value:
		return ""
	return getdate(value).strftime("%Y-%m-%d")


def _apply_success(doc, payload, response, invoice_number, resync=False):
	"""Compatibility wrapper for sandbox probes — always persists + commits."""
	from di.integrations.fbr_outcome import persist_post_success

	return persist_post_success(doc, payload, response, invoice_number, resync=resync)


def _handle_standalone_error(doc, payload, response):
	from di.integrations.fbr_outcome import persist_post_rejection

	_error_code, error_msg = persist_post_rejection(doc, payload, response)
	frappe.throw(_("Digital Invoicing Error:\n{0}").format(error_msg))


def _generate_qr(invoice_number):
	from di.integrations.qr_code import generate_qr_code

	return generate_qr_code(invoice_number) if invoice_number else ""
