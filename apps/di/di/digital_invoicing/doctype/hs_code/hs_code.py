import frappe
from frappe.model.document import Document
from frappe.query_builder.functions import Max


class HSCode(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		description: DF.Text | None
		hs_code: DF.Data
		uom: DF.Link | None
	# end: auto-generated types

	def before_save(self):
		if self.description:
			words = self.description.split()
			self.short_description = " ".join(words[:5])
			if len(words) > 5:
				self.short_description += "..."
		else:
			self.short_description = ""

		if not self.sr_no:
			hs_code = frappe.qb.DocType("HS Code")
			max_sr_no = (
				frappe.qb.from_(hs_code)
				.select(Max(hs_code.sr_no))
				.run()[0][0]
				or 0
			)
			self.sr_no = max_sr_no + 1
