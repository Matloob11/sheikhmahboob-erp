from frappe.model.document import Document


class Scenario(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		description: DF.Data
		sale__purchase_type: DF.Data
		sn_no: DF.Data
	# end: auto-generated types

	pass
