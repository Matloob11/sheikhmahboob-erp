from decimal import ROUND_HALF_UP, Decimal

import frappe
from frappe import _
from frappe.model.document import Document


def _as_decimal(value) -> Decimal:
	if value in (None, ""):
		return Decimal("0")
	return Decimal(str(value))


def _round_currency(value) -> float:
	return float(_as_decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


class SaleTaxInvoice(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from di.digital_invoicing.doctype.sale_tax_invoice_item.sale_tax_invoice_item import (
			SaleTaxInvoiceItem,
		)

		amended_from: DF.Link | None
		buyer: DF.Link
		buyer_address: DF.SmallText | None
		buyer_ntncnic: DF.Data | None
		buyer_province: DF.Data | None
		buyer_registration_type: DF.Data | None
		fbr_invoice_no: DF.Data | None
		fbr_environment: DF.Literal["Sandbox", "Production"]
		invoice_date: DF.Date
		invoice_items: DF.Table[SaleTaxInvoiceItem]
		invoice_type: DF.Literal["Sale Invoice"]
		qr_code: DF.HTML | None
		qr_code_data: DF.HTMLEditor | None
		scenario_id: DF.Link
		seller__business_name: DF.Link
		seller_address: DF.SmallText | None
		seller_ntncnic: DF.Data | None
		seller_province: DF.Data | None
		total_sales: DF.Currency
		total_sales_with_taxes: DF.Currency
		total_taxes: DF.Currency
	# end: auto-generated types

	def validate(self):
		self._sync_buyer_details()
		self._sync_seller_details()
		self._sync_item_details()
		self._validate_seller_scope()
		self._apply_scenario_sale_type()
		self._calculate_totals()
		self._set_qr_code_data()

	def before_submit(self):
		if not self.get("invoice_items"):
			frappe.throw(_("At least one invoice item is required."))
		if not self.fbr_invoice_no:
			from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice

			post_sale_tax_invoice(self)

	def _sync_buyer_details(self):
		if not self.buyer:
			return

		buyer = frappe.db.get_value(
			"Buyer",
			self.buyer,
			["buyer_registration_type", "buyer_ntncnic", "buyer_address", "buyer_province"],
			as_dict=1,
		)
		if not buyer:
			return

		self.buyer_registration_type = buyer.buyer_registration_type
		self.buyer_ntncnic = buyer.buyer_ntncnic
		self.buyer_address = buyer.buyer_address
		self.buyer_province = buyer.buyer_province

	def _sync_seller_details(self):
		if not self.seller__business_name:
			return

		seller = frappe.db.get_value(
			"Seller Or Company",
			self.seller__business_name,
			["seller_ntncnic", "seller_address", "seller_province"],
			as_dict=1,
		)
		if not seller:
			return

		self.seller_ntncnic = seller.seller_ntncnic
		self.seller_address = seller.seller_address
		self.seller_province = seller.seller_province

	def _validate_seller_scope(self):
		"""Keep one company's buyers and items out of another company's invoice.

		Buyer and Tax Item carry an optional Seller / Company. Blank means shared
		across every company, which is the old behaviour and stays valid. Where
		it is set, it must match the seller on this invoice — otherwise a sale is
		filed under one tax identity using another's customer record.
		"""
		if not self.seller__business_name:
			return

		buyer_seller = frappe.db.get_value("Buyer", self.buyer, "seller") if self.buyer else None
		if buyer_seller and buyer_seller != self.seller__business_name:
			frappe.throw(
				_("Buyer {0} belongs to {1}, not to {2}.").format(
					self.buyer, buyer_seller, self.seller__business_name
				)
			)

		for row in self.get("invoice_items") or []:
			if not row.description:
				continue
			item_seller = frappe.db.get_value("Tax Item", row.description, "seller")
			if item_seller and item_seller != self.seller__business_name:
				frappe.throw(
					_("Row {0}: item {1} belongs to {2}, not to {3}.").format(
						row.idx, row.description, item_seller, self.seller__business_name
					)
				)

	def _sync_item_details(self):
		for row in self.get("invoice_items") or []:
			if not row.description:
				continue

			item = frappe.db.get_value(
				"Tax Item",
				row.description,
				["hs_code", "product_uom", "tax_desc", "rate_in_p", "fixed_rs"],
				as_dict=1,
			)
			if not item:
				continue

			row.hs_code = item.hs_code
			row.uom = item.product_uom
			row.rate_in_percentage = item.tax_desc
			row.tax_rate_value = item.rate_in_p
			row.fixed_notified_value_or_retail_price = item.fixed_rs

	def _apply_scenario_sale_type(self):
		if not self.scenario_id:
			return

		sale_type = frappe.db.get_value("Scenario", self.scenario_id, "sale__purchase_type") or ""
		if not sale_type:
			return

		for row in self.get("invoice_items") or []:
			row.sale_type = sale_type

	def _calculate_totals(self):
		total_sales = Decimal("0")
		total_taxes = Decimal("0")
		total_sales_with_taxes = Decimal("0")

		for row in self.get("invoice_items") or []:
			quantity = _as_decimal(row.quantity)
			sale_rate = _as_decimal(row.sale_rate)
			discount = _as_decimal(row.discount)
			tax_rate = _as_decimal(row.tax_rate_value)
			fixed_price = _as_decimal(row.fixed_notified_value_or_retail_price)

			value_sales = max(quantity * sale_rate - discount, Decimal("0"))
			tax_base = value_sales
			if row.sale_type == "3rd Schedule Goods" and fixed_price:
				tax_base = fixed_price * quantity if quantity else fixed_price
			sales_tax = tax_base * tax_rate / Decimal("100")

			extra_tax = _as_decimal(row.extra_tax)
			further_tax = _as_decimal(row.further_tax)
			fed_payable = _as_decimal(row.fed_payable)
			sales_tax_withheld = _as_decimal(row.sales_tax_withheld_at_source)
			line_taxes = sales_tax + sales_tax_withheld + extra_tax + further_tax + fed_payable
			line_total = value_sales + line_taxes

			row.value_sales_excluding_st = _round_currency(value_sales)
			row.sales_tax_applicable = _round_currency(sales_tax)
			row.total_values = _round_currency(line_total)

			total_sales += value_sales
			total_taxes += line_taxes
			total_sales_with_taxes += line_total

		self.total_sales = _round_currency(total_sales)
		self.total_taxes = _round_currency(total_taxes)
		self.total_sales_with_taxes = _round_currency(total_sales_with_taxes)

	def _set_qr_code_data(self):
		if not self.fbr_invoice_no:
			self.qr_code_data = ""
			return

		try:
			from di.integrations.qr_code import generate_qr_code

			self.qr_code_data = generate_qr_code(self.fbr_invoice_no) or ""
		except Exception:
			frappe.log_error(frappe.get_traceback(), _("Sale Tax Invoice QR Code Error"))
