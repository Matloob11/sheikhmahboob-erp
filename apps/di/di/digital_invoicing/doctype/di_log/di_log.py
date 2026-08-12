import json

import frappe
from frappe.model.document import Document


class DILog(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		api_type: DF.Literal["DI Post", "DI Validate", "POS Fiscal", "Reference", "STATL"]
		document_name: DF.DynamicLink | None
		document_type: DF.Link | None
		error_code: DF.Data | None
		error_message: DF.LongText | None
		fbr_invoice_number: DF.Data | None
		payload: DF.Code | None
		response: DF.Code | None
		status: DF.Literal["Success", "Error"]
		title: DF.Data | None
	# end: auto-generated types

	pass


def explain_error(error_code, error_message=""):
	"""Add the plain-language meaning of an FBR error code to the message.

	The app ships 46 codes with descriptions in DI Error Code but nothing ever
	looked them up, so users saw only "0077" and a sentence of FBR wording.
	"""
	code = str(error_code or "").strip()
	if not code:
		return error_message

	row = frappe.db.get_value("DI Error Code", code, ["message", "description"], as_dict=True)
	if not row:
		return error_message

	parts = [p for p in (error_message, row.get("message"), row.get("description")) if p]
	seen = []
	for part in parts:
		if part not in seen:
			seen.append(part)
	return "\n".join(seen)


def create_log(
	doctype,
	docname,
	payload,
	response,
	status="Success",
	title="",
	api_type="DI Post",
	error_code="",
	error_message="",
	fbr_invoice_number="",
):
	"""Create a DI Log entry for audit trail."""
	frappe.get_doc(
		{
			"doctype": "DI Log",
			"title": title or f"{status}: {doctype} {docname}",
			"document_type": doctype,
			"document_name": docname,
			"api_type": api_type,
			"status": status,
			"payload": json.dumps(payload, default=str, indent=2)
			if isinstance(payload, dict)
			else str(payload),
			"response": json.dumps(response, default=str, indent=2)
			if isinstance(response, dict)
			else str(response),
			"error_code": error_code,
			"error_message": explain_error(error_code, error_message),
			"fbr_invoice_number": fbr_invoice_number,
		}
	).insert(ignore_permissions=True)
