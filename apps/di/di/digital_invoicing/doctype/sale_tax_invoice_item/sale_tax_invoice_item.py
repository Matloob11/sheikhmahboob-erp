from frappe.model.document import Document


class SaleTaxInvoiceItem(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		description: DF.Link
		discount: DF.Currency
		extra_tax: DF.Currency
		fed_payable: DF.Currency
		fixed_notified_value_or_retail_price: DF.Float
		further_tax: DF.Currency
		hs_code: DF.Data
		quantity: DF.Float
		rate_in_percentage: DF.Data
		sale_rate: DF.Currency
		sale_type: DF.Data | None
		sales_tax_applicable: DF.Currency
		sales_tax_withheld_at_source: DF.Currency
		sro_item_serial_no: DF.Data | None
		sro_schedule_no: DF.Data | None
		tax_rate_value: DF.Float
		total_values: DF.Currency
		uom: DF.Data
		value_sales_excluding_st: DF.Currency
	# end: auto-generated types

	pass
