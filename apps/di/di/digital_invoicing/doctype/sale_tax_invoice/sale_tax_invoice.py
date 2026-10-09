from decimal import ROUND_HALF_UP, Decimal

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr

from di.invoice_rules import (
	extra_rupees_per_qty,
	row_needs_retail_price,
	row_needs_sro,
	sale_type_needs_retail_price,
	settled_retail_price,
)


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
		sandbox_run_status: DF.Literal["", "Pending Review", "FBR Validated", "Already Successful"]
		invoice_date: DF.Date
		invoice_items: DF.Table[SaleTaxInvoiceItem]
		invoice_type: DF.Literal["Sale Invoice", "Debit Note"]
		qr_code: DF.HTML | None
		qr_code_data: DF.HTMLEditor | None
		return_against: DF.Link | None
		scenario_id: DF.Link | None
		seller__business_name: DF.Link
		seller_address: DF.SmallText | None
		seller_ntncnic: DF.Data | None
		seller_province: DF.Data | None
		total_sales: DF.Currency
		total_sales_with_taxes: DF.Currency
		total_taxes: DF.Currency
	# end: auto-generated types

	def validate(self):
		self._enforce_production_for_panel()
		self._validate_scenario_requirement()
		self._sync_buyer_details()
		self._sync_seller_details()
		self._sync_item_details()
		self._validate_seller_scope()
		self._apply_scenario_sale_type()
		self._validate_item_sale_type()
		self._validate_debit_note()
		self._warn_buyer_registration_mismatch()
		self._ensure_third_schedule_prices()
		self._calculate_totals()
		self._set_qr_code_data()
		self._refuse_changes_after_filing()

	def before_submit(self):
		self._enforce_production_for_panel()
		if not self.get("invoice_items"):
			frappe.throw(_("At least one invoice item is required."))
		self._apply_scenario_sale_type()
		self._ensure_third_schedule_prices()
		self._validate_sro()
		self._validate_third_schedule_price()
		if not self.fbr_invoice_no:
			from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice

			post_sale_tax_invoice(self)

	def _enforce_production_for_panel(self):
		"""Client panel users always file on FBR Production — never Sandbox."""
		from di.panel import is_panel_user

		user = frappe.session.user
		owner = cstr(self.owner or "")
		if is_panel_user(user) or (owner and is_panel_user(owner)):
			self.fbr_environment = "Production"

	def _validate_scenario_requirement(self):
		"""Scenario ID selects a sandbox FBR scenario; Production has none."""
		environment = cstr(self.get("fbr_environment") or "")
		if environment == "Sandbox" and not self.get("scenario_id"):
			frappe.throw(_("Scenario ID is required for a Sandbox invoice."))

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
				["hs_code", "product_uom", "tax_desc", "rate_in_p", "fixed_rs", "transaction_type"],
				as_dict=1,
			)
			if not item:
				continue

			# fetch_if_empty on the item JSON is not enough alone: this sync
			# used to overwrite every save, so a corrected UOM never stuck.
			if not cstr(row.get("hs_code") or "").strip() and item.hs_code:
				row.hs_code = item.hs_code
			if not cstr(row.get("uom") or "").strip() and item.product_uom:
				row.uom = item.product_uom
			row.rate_in_percentage = item.tax_desc
			row.tax_rate_value = item.rate_in_p
			# FBR 0090 treats 0 as missing. Do not wipe a recipe/sale-rate value.
			if item.fixed_rs:
				row.fixed_notified_value_or_retail_price = item.fixed_rs
			# A blank sale type silently sends rate="0%" instead of the real
			# FBR rate and disables SRO/retail-price checks below, so default
			# it from the item but never override a row someone already set.
			if not cstr(row.get("sale_type") or "").strip() and item.transaction_type:
				row.sale_type = item.transaction_type
			uom = cstr(row.get("uom") or "").strip()
			if uom and not frappe.db.exists("HS Uom", uom):
				frappe.throw(_("Row {0}: UOM {1} is not an HS Uom.").format(row.idx, uom))

	def _ensure_third_schedule_prices(self):
		for row in self.get("invoice_items") or []:
			if not row_needs_retail_price(row.sale_type, row.fixed_notified_value_or_retail_price):
				continue
			row.fixed_notified_value_or_retail_price = settled_retail_price(
				row.sale_type, row.fixed_notified_value_or_retail_price, row.sale_rate
			)

	def _validate_third_schedule_price(self):
		for row in self.get("invoice_items") or []:
			if row_needs_retail_price(row.sale_type, row.fixed_notified_value_or_retail_price):
				frappe.throw(
					_(
						"Row {0}: sale type {1} needs a Fixed/Notified Value or Retail Price."
					).format(row.idx, row.sale_type)
				)

	def _validate_sro(self):
		for row in self.get("invoice_items") or []:
			if row_needs_sro(row.tax_rate_value, row.sale_type, row.sro_schedule_no):
				frappe.throw(
					_(
						"Row {0}: FBR needs an SRO Schedule for sale type {1}. Pick one in the item row or use Fill SRO Details."
					).format(row.idx, row.sale_type)
				)

	def _apply_scenario_sale_type(self):
		"""Only a Sandbox scenario forces every row to its one sale type.

		Production invoices keep whatever sale type each row carries — FBR
		accepts different sale types on one Production invoice, and the
		scenario field there is only a required Select, not a real choice.
		"""
		if cstr(self.get("fbr_environment") or "") != "Sandbox":
			return
		if not self.scenario_id:
			return

		sale_type = frappe.db.get_value("Scenario", self.scenario_id, "sale__purchase_type") or ""
		if not sale_type:
			return

		for row in self.get("invoice_items") or []:
			row.sale_type = sale_type

	def _validate_item_sale_type(self):
		"""A blank or unknown sale type silently sends rate="0%" (FBR 0007/0013)."""
		for row in self.get("invoice_items") or []:
			sale_type = cstr(row.get("sale_type") or "").strip()
			if not sale_type:
				frappe.throw(_("Row {0}: Sale Type is required.").format(row.idx))
			if not frappe.db.exists("Sale Type", sale_type):
				frappe.throw(_("Row {0}: {1} is not a known Sale Type.").format(row.idx, sale_type))

	def _warn_buyer_registration_mismatch(self):
		"""Non-blocking: stored FBR status disagrees with the invoice registration type."""
		from di.integrations.statl import registration_mismatch

		if not self.buyer:
			return
		stored = frappe.db.get_value("Buyer", self.buyer, "fbr_registration_status")
		if registration_mismatch(self.buyer_registration_type, stored):
			frappe.msgprint(
				_(
					"Buyer {0} was last verified with FBR as {1}, but this invoice says {2}."
				).format(self.buyer, stored, self.buyer_registration_type),
				indicator="orange",
				alert=True,
			)

	def _validate_debit_note(self):
		"""A Debit Note must point at a submitted, filed invoice it can correct."""
		if cstr(self.get("invoice_type") or "") != "Debit Note":
			return

		name = cstr(self.get("return_against") or "").strip()
		if not name:
			frappe.throw(_("Return Against is required for a Debit Note."))

		original = frappe.db.get_value(
			"Sale Tax Invoice",
			name,
			["docstatus", "seller__business_name", "fbr_environment", "fbr_invoice_no"],
			as_dict=True,
		)
		if not original:
			frappe.throw(_("Sale Tax Invoice {0} was not found.").format(name))
		if original.docstatus != 1:
			frappe.throw(_("{0} must be submitted before a Debit Note can refer to it.").format(name))
		if original.seller__business_name != self.seller__business_name:
			frappe.throw(_("{0} belongs to a different seller than this Debit Note.").format(name))
		if original.fbr_environment != self.get("fbr_environment"):
			frappe.throw(
				_("{0} was filed in a different FBR environment than this Debit Note.").format(name)
			)
		if not cstr(original.fbr_invoice_no or "").strip():
			frappe.throw(_("{0} has no FBR invoice number yet.").format(name))

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
			if sale_type_needs_retail_price(row.sale_type) and fixed_price:
				tax_base = fixed_price * quantity if quantity else fixed_price
			sales_tax = tax_base * tax_rate / Decimal("100")
			sales_tax += extra_rupees_per_qty(row.get("rate_in_percentage")) * quantity

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

	def _refuse_changes_after_filing(self):
		"""Once FBR has a number, the payload is frozen until Submit or a Debit Note."""
		number = cstr(self.get("fbr_invoice_no") or "").strip()
		if not number or self.is_new():
			return
		stored_hash = cstr(self.get("fbr_payload_hash") or "").strip()
		if not stored_hash:
			return
		from di.integrations.fbr_outcome import payload_hash
		from di.integrations.sale_tax_invoice_api import build_sale_tax_invoice_payload

		current = payload_hash(build_sale_tax_invoice_payload(self))
		if current != stored_hash:
			frappe.throw(
				_(
					"Already filed with FBR as {0}; this invoice cannot be changed. "
					"Submit it as-is or create a Debit Note."
				).format(number)
			)


@frappe.whitelist()
def make_debit_note(name):
	"""Draft a Debit Note against a submitted, filed Sale Tax Invoice.

	Cancel/amend is deliberately off for panel users (a production filing has
	no retraction), so a Debit Note is the only correction path. It starts as
	an exact copy and is then re-pointed: a fresh FBR number, no inherited QR
	code or payload hash, and ``return_against`` naming the original.
	"""
	original = frappe.get_doc("Sale Tax Invoice", name)
	frappe.has_permission("Sale Tax Invoice", "submit", doc=original, throw=True)
	if original.docstatus != 1:
		frappe.throw(_("{0} must be submitted before a Debit Note can be made against it.").format(name))
	if not cstr(original.get("fbr_invoice_no") or "").strip():
		frappe.throw(_("{0} has no FBR invoice number yet.").format(name))

	draft = frappe.copy_doc(original, ignore_no_copy=False)
	draft.fbr_invoice_no = ""
	draft.qr_code_data = ""
	draft.qr_code = ""
	draft.sandbox_run_status = ""
	draft.fbr_payload_hash = ""
	draft.amended_from = ""
	draft.invoice_type = "Debit Note"
	draft.return_against = name
	draft.fbr_environment = original.fbr_environment
	draft.insert()
	return draft.name
