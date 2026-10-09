import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr


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
	# end: auto-generated types

	def validate(self):
		from di.panel import is_panel_user

		# Shared walk-in buyers (blank seller) are administrator-only. A panel
		# user saving one would open a cross-tenant write path through that row.
		if is_panel_user() and not cstr(self.get("seller") or "").strip():
			frappe.throw(
				_("Client Panel users must assign a Seller on Buyer {0}.").format(
					cstr(self.get("buyer_businessname") or self.name or _("(new)"))
				)
			)
