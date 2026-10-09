import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, now_datetime


class Buyer(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		buyer_address: DF.LongText
		buyer_businessname: DF.Data
		buyer_ntncnic: DF.Data
		buyer_province: DF.Literal[
			"BALOCHISTAN",
			"AZAD JAMMU AND KASHMIR",
			"CAPITAL TERRITORY",
			"KHYBER PAKHTUNKHWA",
			"PUNJAB",
			"SINDH",
			"GILGIT BALTISTAN",
		]
		buyer_registration_type: DF.Literal["Registered", "Unregistered"]
		fbr_registration_status: DF.Data | None
		fbr_verified_on: DF.Datetime | None
		seller: DF.Link | None
	# end: auto-generated types

	def validate(self):
		from di.panel import is_panel_user
		from frappe.utils import escape_html

		name = cstr(self.get("buyer_businessname") or "")
		if "<" in name or ">" in name:
			frappe.throw(_("Buyer name cannot contain < or >."))

		# Shared walk-in buyers (blank seller) are administrator-only. A panel
		# user saving one would open a cross-tenant write path through that row.
		if is_panel_user() and not cstr(self.get("seller") or "").strip():
			frappe.throw(
				_("Client Panel users must assign a Seller on Buyer {0}.").format(
					escape_html(name or self.name or _("(new)"))
				)
			)


@frappe.whitelist()
def verify_buyer_with_fbr(buyer):
	"""Verify Buyer NTN against FBR using the seller's production token."""
	from di.integrations.seller_credentials import resolve_seller_arg
	from di.integrations.statl import _fetch_registration_type, normalise_registration_type

	doc = frappe.get_doc("Buyer", buyer)
	frappe.has_permission("Buyer", "write", doc=doc, throw=True)

	seller = cstr(doc.get("seller") or "").strip() or resolve_seller_arg()
	if not seller:
		frappe.throw(_("Seller is required to verify this buyer with FBR."))
	frappe.has_permission("Seller Or Company", "read", doc=seller, throw=True)

	seller_doc = frappe.get_doc("Seller Or Company", seller)
	token = cstr(seller_doc.get_password("production_token", raise_exception=False) or "").strip()
	if not token:
		frappe.throw(
			_(
				"Seller Or Company {0} has no production_token. "
				"Sandbox tokens answer 'unregistered' for real NTNs — use Production."
			).format(seller)
		)

	result = _fetch_registration_type(doc.buyer_ntncnic, token, "Buyer", doc.name)
	status = normalise_registration_type(result)
	doc.db_set("fbr_registration_status", status, update_modified=False)
	doc.db_set("fbr_verified_on", now_datetime(), update_modified=False)
	return {"fbr_registration_status": status, "raw": result}
