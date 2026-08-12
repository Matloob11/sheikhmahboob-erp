from frappe.model.document import Document


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

	pass
