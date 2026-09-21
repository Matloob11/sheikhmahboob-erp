from frappe.model.document import Document


class SellerOrCompany(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		production_token: DF.Data | None
		sandbox_token: DF.Data | None
		seller__business_name: DF.Data
		seller_address: DF.LongText
		seller_ntncnic: DF.Data | None
		seller_province: DF.Literal[
			"BALOCHISTAN",
			"AZAD JAMMU AND KASHMIR",
			"CAPITAL TERRITORY",
			"KHYBER PAKHTUNKHWA",
			"PUNJAB",
			"SINDH",
			"GILGIT BALTISTAN",
		]
	# end: auto-generated types

	def validate(self):
		from di.panel import enforce_single_client_seller_cap

		enforce_single_client_seller_cap(self)

	def after_insert(self):
		from di.panel import grant_creator_seller_permission

		grant_creator_seller_permission(self)
