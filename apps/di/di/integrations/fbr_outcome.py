"""Persist FBR post/validate outcomes before the request can roll them back."""

from __future__ import annotations

import hashlib
import json

import frappe
from frappe.utils import cstr, now

from di.digital_invoicing.doctype.di_log.di_log import create_log, explain_error


def payload_hash(payload) -> str:
	return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode("utf-8")).hexdigest()


def summarise_validation_errors(response) -> tuple[str, str]:
	"""Return ``(error_code, message)`` from an FBR validate/post rejection body."""
	error_parts = []
	vr = (response or {}).get("validationResponse") or {}

	if vr.get("error"):
		error_parts.append(explain_error(vr.get("errorCode"), vr["error"]))

	for item_status in vr.get("invoiceStatuses") or []:
		if item_status.get("status") != "Valid" and item_status.get("error"):
			detail = explain_error(item_status.get("errorCode"), item_status["error"])
			error_parts.append(f"Item {item_status.get('itemSNo', '?')}: {detail}")

	error_msg = "\n".join(error_parts) if error_parts else str(response)
	return cstr(vr.get("errorCode") or ""), error_msg


def _maybe_commit():
	if getattr(frappe.flags, "in_test", False):
		return
	frappe.db.commit()


def persist_post_success(doc, payload, response, invoice_number, *, resync=False):
	"""Log success, freeze payload hash, and db_set the filed number when possible."""
	dated = (response or {}).get("dated", now())
	digest = payload_hash(payload)
	is_new = callable(getattr(doc, "is_new", None)) and doc.is_new()

	if doc.doctype == "Sale Tax Invoice":
		from di.integrations.qr_code import generate_qr_code

		doc.fbr_invoice_no = invoice_number
		doc.qr_code_data = generate_qr_code(invoice_number) or ""
		doc.fbr_payload_hash = digest
		if not is_new:
			doc.db_set("fbr_invoice_no", invoice_number, update_modified=False)
			doc.db_set("qr_code_data", doc.qr_code_data, update_modified=False)
			doc.db_set("fbr_payload_hash", digest, update_modified=False)
		else:
			frappe.log_error(
				f"FBR filed {invoice_number} for new {doc.doctype} (no name yet); DI Log holds the number.",
				"FBR number not stored on document",
			)
	else:
		doc.di_integration_id = invoice_number
		doc.is_di_posted = 1
		doc.di_posting_datetime = dated
		if not is_new:
			doc.db_set("di_integration_id", invoice_number, update_modified=False)
			doc.db_set("is_di_posted", 1, update_modified=False)
			doc.db_set("di_posting_datetime", dated, update_modified=False)
		else:
			frappe.log_error(
				f"FBR filed {invoice_number} for new {doc.doctype}; DI Log holds the number.",
				"FBR number not stored on document",
			)

	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Success",
		api_type="DI Post",
		title=f"{doc.doctype} Post Success: {doc.name}",
		fbr_invoice_number=invoice_number,
	)
	_maybe_commit()
	return dated


def persist_post_rejection(doc, payload, response):
	"""Log a structured FBR rejection and commit before the caller throws."""
	error_code, error_msg = summarise_validation_errors(response)
	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Error",
		api_type="DI Post",
		title=f"{doc.doctype} Post Error: {doc.name}",
		error_code=error_code,
		error_message=error_msg,
	)
	_maybe_commit()
	return error_code, error_msg


def persist_post_exception(doc, payload, exc):
	"""Log a transport/uncertain/rejected exception and commit before re-raise."""
	create_log(
		doc.doctype,
		doc.name,
		payload,
		str(exc),
		status="Error",
		api_type="DI Post",
		title=f"{doc.doctype} Post Error: {doc.name}",
		error_message=cstr(exc),
	)
	_maybe_commit()


def persist_validate_outcome(doc, payload, response=None, exc=None):
	"""Log a validate call (success, rejection body, or exception) with a real message."""
	if exc is not None:
		create_log(
			doc.doctype,
			doc.name,
			payload,
			str(exc),
			status="Error",
			api_type="DI Validate",
			title=f"{doc.doctype} Validate Error: {doc.name}",
			error_message=cstr(exc),
		)
		_maybe_commit()
		return

	from di.integrations.di_api import _is_valid_response

	ok = _is_valid_response(response or {})
	error_code, error_msg = ("", "")
	if not ok:
		error_code, error_msg = summarise_validation_errors(response)
	create_log(
		doc.doctype,
		doc.name,
		payload,
		response,
		status="Success" if ok else "Error",
		api_type="DI Validate",
		title=f"{doc.doctype} Validate: {doc.name}",
		error_code=error_code,
		error_message=error_msg,
	)
	_maybe_commit()
