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


def post_sale_tax_invoice(doc, resync=False):
	"""Submit a standalone Sale Tax Invoice to FBR."""
	if not resync and doc.get("fbr_invoice_no"):
		return

	payload = build_sale_tax_invoice_payload(doc)
	url = _get_post_url(doc)
	token = _get_seller_token(doc)

	try:
		response = _make_request(url, payload, token)
	except Exception as e:
		create_log(
			doc.doctype,
			doc.name,
			payload,
			str(e),
			status="Error",
			api_type="DI Post",
			title=f"Sale Tax Invoice Post Error: {doc.name}",
		)
		# Keep the error type: it says whether this may be sent again.
		raise

	invoice_number = cstr(response.get("invoiceNumber") or "").strip()
	if not invoice_number:
		_handle_standalone_error(doc, payload, response)

	_apply_success(doc, payload, response, invoice_number, resync=resync)
	return response


def validate_sale_tax_invoice(doc):
	"""Validate a standalone Sale Tax Invoice with FBR without posting."""
	payload = build_sale_tax_invoice_payload(doc)
	url = _get_validate_url(doc)
	token = _get_seller_token(doc)

	try:
		response = _make_request(url, payload, token)
	except Exception as e:
		create_log(
			doc.doctype,
			doc.name,
			payload,
			str(e),
			status="Error",
			api_type="DI Validate",
			title=f"Sale Tax Invoice Validate Error: {doc.name}",
		)
		raise

	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Success" if _is_valid_response(response) else "Error",
		api_type="DI Validate",
		title=f"Sale Tax Invoice Validate: {doc.name}",
	)
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
	doc._calculate_totals()

	invoice = Invoice(
		invoiceType=doc.invoice_type,
		invoiceDate=_format_date(doc.invoice_date),
		sellerBusinessName=cstr(doc.seller__business_name or ""),
		sellerNTNCNIC=cstr(doc.seller_ntncnic or ""),
		sellerProvince=cstr(doc.seller_province or ""),
		sellerAddress=cstr(doc.seller_address or ""),
		buyerNTNCNIC=cstr(doc.buyer_ntncnic or ""),
		buyerBusinessName=cstr(doc.buyer or ""),
		buyerRegistrationType=cstr(doc.buyer_registration_type or ""),
		buyerProvince=cstr(doc.buyer_province or ""),
		buyerAddress=cstr(doc.buyer_address or ""),
		invoiceRefNo="",
		items=[_build_item_payload(row) for row in doc.get("invoice_items") or []],
	)
	payload = asdict(invoice)

	if _get_environment(doc) == "Sandbox" and doc.get("scenario_id"):
		payload["scenarioId"] = doc.scenario_id

	return payload


def _build_item_payload(row):
	sale_type = cstr(row.get("sale_type") or "")
	extra_tax = "" if sale_type == "Goods at Reduced Rate" else _round_currency(row.get("extra_tax", 0))

	return asdict(
		InvoiceItem(
			discount=_round_currency(row.get("discount", 0)),
			fedPayable=_round_currency(row.get("fed_payable", 0)),
			furtherTax=_round_currency(row.get("further_tax", 0)),
			hsCode=cstr(row.get("hs_code") or ""),
			extraTax=extra_tax,
			productDescription=cstr(row.get("description") or ""),
			quantity=round(float(row.get("quantity") or 0), 4),
			rate=_format_rate(row.get("tax_rate_value", 0), sale_type),
			salesTaxApplicable=_round_currency(row.get("sales_tax_applicable", 0)),
			salesTaxWithheldAtSource=_round_currency(row.get("sales_tax_withheld_at_source", 0)),
			sroItemSerialNo=cstr(row.get("sro_item_serial_no") or ""),
			sroScheduleNo=cstr(row.get("sro_schedule_no") or ""),
			totalValues=_round_currency(row.get("total_values", 0)),
			uoM=cstr(row.get("uom") or ""),
			valueSalesExcludingST=_round_currency(row.get("value_sales_excluding_st", 0)),
			saleType=sale_type,
			fixedNotifiedValueOrRetailPrice=_round_currency(
				row.get("fixed_notified_value_or_retail_price", 0)
			),
		)
	)


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
	dated = response.get("dated", now())

	if resync:
		doc.db_set("fbr_invoice_no", invoice_number, update_modified=False)
		doc.db_set("qr_code_data", _generate_qr(invoice_number), update_modified=False)
	else:
		doc.fbr_invoice_no = invoice_number
		doc.qr_code_data = _generate_qr(invoice_number)

	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Success",
		api_type="DI Post",
		title=f"Sale Tax Invoice Post Success: {doc.name}",
		fbr_invoice_number=invoice_number,
	)
	return dated


def _handle_standalone_error(doc, payload, response):
	from di.digital_invoicing.doctype.di_log.di_log import explain_error

	error_parts = []
	vr = response.get("validationResponse", {})

	if vr.get("error"):
		error_parts.append(explain_error(vr.get("errorCode"), vr["error"]))

	for item_status in vr.get("invoiceStatuses") or []:
		if item_status.get("status") != "Valid" and item_status.get("error"):
			detail = explain_error(item_status.get("errorCode"), item_status["error"])
			error_parts.append(f"Item {item_status.get('itemSNo', '?')}: {detail}")

	error_msg = "\n".join(error_parts) if error_parts else str(response)
	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Error",
		api_type="DI Post",
		title=f"Sale Tax Invoice Post Error: {doc.name}",
		error_code=vr.get("errorCode", ""),
		error_message=error_msg,
	)
	frappe.throw(_("Digital Invoicing Error:\n{0}").format(error_msg))


def _generate_qr(invoice_number):
	from di.integrations.qr_code import generate_qr_code

	return generate_qr_code(invoice_number) if invoice_number else ""
