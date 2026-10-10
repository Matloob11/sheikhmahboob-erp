import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, cstr

from di.constants import PRODUCT_UOM_OPTIONS


class TaxItem(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		fixed_rs: DF.Float
		hs_code: DF.Link
		product_description: DF.Data
		product_uom: DF.Data
		rate_id: DF.Int
		rate_in_p: DF.Float
		tax_desc: DF.Data
		transaction_type: DF.Link | None
	# end: auto-generated types

	def validate(self):
		from di.integrations.reference_api import _ensure_hs_uom

		name = cstr(self.get("product_description") or getattr(self, "name", None) or "")
		if "<" in name or ">" in name:
			frappe.throw(_("Product description cannot contain < or >."))

		uom = cstr(self.get("product_uom") or "").strip()
		if uom:
			if self.is_new() or self.has_value_changed("product_uom"):
				if not frappe.db.exists("HS Uom", uom):
					frappe.throw(_("Product UOM {0} is not in HS Uom.").format(uom))
			elif not frappe.db.exists("HS Uom", uom):
				# Unchanged value left behind when seed used to delete FBR UOMs.
				_ensure_hs_uom(uom)

		tax_desc = cstr(self.get("tax_desc") or "").strip()
		if not tax_desc:
			frappe.throw(_("Tax description (tax_desc) is required."))
		# Plain percentages like "18%" must match rate_in_p.
		if tax_desc.endswith("%") and tax_desc[:-1].replace(".", "", 1).isdigit():
			expected = float(tax_desc[:-1])
			if abs(float(self.get("rate_in_p") or 0) - expected) > 0.0001:
				frappe.throw(
					_("rate_in_p ({0}) must equal tax_desc percentage {1}.").format(
						self.get("rate_in_p"), tax_desc
					)
				)


@frappe.whitelist()
def refresh_product_uom_from_fbr(name):
	"""Refresh this Tax Item's product_uom from FBR; update HS Code.uom only with write."""
	doc = frappe.get_doc("Tax Item", name)
	frappe.has_permission("Tax Item", "write", doc=doc, throw=True)
	from di.integrations.reference_api import fetch_hs_code_uom

	uom = fetch_hs_code_uom(doc.hs_code, seller=doc.seller, force=True)
	if not uom:
		frappe.throw(_("FBR returned no UOM for HS Code {0}.").format(doc.hs_code))
	doc.db_set("product_uom", uom, update_modified=False)
	return {"product_uom": uom}


@frappe.whitelist()
def get_hs_code_details(hs_code):
	if not hs_code:
		return {}

	details = frappe.db.get_value(
		"HS Code",
		hs_code,
		["short_description", "description", "uom"],
		as_dict=True,
	)
	if not details:
		frappe.throw(_("HS Code {0} was not found").format(hs_code))

	description_options = get_hs_code_description_options(
		details.description or "", details.short_description or ""
	)
	product_description = description_options[0]["value"] if description_options else (
		details.short_description or hs_code
	)
	return {
		"product_description": product_description,
		"product_uom": details.uom or "",
		"short_description": details.short_description or "",
		"description": details.description or "",
		"description_options": description_options,
	}


def get_hs_code_description_options(description, short_description=None):
	"""Return concise selectable description parts for a full FBR HS description."""
	max_length = 140
	candidates = []
	description = _clean_description_part(description)
	short_description = _clean_description_part(short_description)

	parts = [_clean_description_part(part) for part in description.split(" - ") if _clean_description_part(part)]

	# The last HS description part is usually the actual product leaf.
	for part in reversed(parts):
		_add_description_candidate(candidates, part, max_length)

	for part in parts:
		for semicolon_part in part.split(";"):
			_add_description_candidate(candidates, semicolon_part, max_length)

	if len(parts) >= 2:
		_add_description_candidate(candidates, f"{parts[-2]} - {parts[-1]}", max_length)

	_add_description_candidate(candidates, short_description, max_length)

	if not candidates and description:
		_add_description_candidate(candidates, description[:max_length], max_length)

	return [
		{
			"number": index,
			"value": value,
			"label": f"{index}. {value}",
			"search_text": f"{index} {value}",
		}
		for index, value in enumerate(candidates, start=1)
	]


def _add_description_candidate(candidates, value, max_length):
	value = _clean_description_part(value)
	if not value or value in candidates:
		return

	if len(value) <= max_length:
		candidates.append(value)


def _clean_description_part(value):
	return " ".join((value or "").replace("\n", " ").split()).strip(" -.,")


@frappe.whitelist()
def get_product_uom_options():
	return [
		{
			"number": index,
			"value": value,
			"label": f"{index}. {value}",
			"search_text": f"{index} {value}",
		}
		for index, value in enumerate(PRODUCT_UOM_OPTIONS, start=1)
	]


@frappe.whitelist()
def get_tax_rate_details(
	hs_code=None,
	product_uom=None,
	transaction_type=None,
	company=None,
	date=None,
	seller=None,
):
	"""Fetch the current FBR rate for the selected item context."""
	from di.integrations.reference_api import _get_company_province_code, get_sale_type_rates
	from di.integrations.seller_credentials import resolve_seller_arg, seller_fbr_context

	frappe.has_permission("Tax Item", "write", throw=True)

	if not hs_code:
		frappe.throw(_("HS Code is required before fetching tax rate."))
	if not product_uom:
		frappe.throw(_("Product UOM is required before fetching tax rate."))

	transaction = _resolve_transaction_type(transaction_type)
	if not transaction:
		frappe.throw(
			_(
				"Transaction Type is required for exact FBR tax rate lookup. Sync Transaction Types or select a Transaction Type."
			)
		)

	seller_name = resolve_seller_arg(seller=seller, company=company)
	rate_token = None
	if seller_name:
		rate_token, origin, _annexure = seller_fbr_context(seller_name)
		rate_company = seller_name
	else:
		from di.integrations.reference_api import _guard_reference_access

		_guard_reference_access()
		origin = _get_company_province_code(company)
		rate_company = company
	rate_rows = get_sale_type_rates(
		date=date,
		trans_type_id=transaction["transaction_type_id"],
		origination_supplier=origin,
		company=rate_company,
		token=rate_token,
	)
	options = [_normalise_rate_row(row) for row in rate_rows]
	options = [row for row in options if row.get("tax_desc")]
	if not options:
		frappe.throw(
			_("FBR returned no tax rates for transaction type {0}.").format(
				transaction["transaction_type"]
			)
		)

	selected, ambiguous = _select_rate_option(options, product_uom)
	selected = dict(selected)
	selected.update(
		{
			"hs_code": hs_code,
			"product_uom": product_uom,
			"transaction_type": transaction["transaction_type"],
			"transaction_type_id": transaction["transaction_type_id"],
			"rate_options": options,
			"ambiguous": ambiguous,
		}
	)
	return selected


def _resolve_transaction_type(transaction_type=None):
	transaction_type = cstr(transaction_type).strip()
	if transaction_type:
		if transaction_type.isdigit():
			row = frappe.db.get_value(
				"Transaction Type",
				{"transaction_type_id": cint(transaction_type)},
				["transaction_desc", "transaction_type_id"],
				as_dict=True,
			)
		else:
			row = frappe.db.get_value(
				"Transaction Type",
				transaction_type,
				["transaction_desc", "transaction_type_id"],
				as_dict=True,
			)
		if row and row.transaction_type_id:
			return {
				"transaction_type": row.transaction_desc,
				"transaction_type_id": row.transaction_type_id,
			}

	default_names = (
		"Goods at standard rate (default)",
		"Goods at Standard Rate (default)",
		"Goods at standard rate",
	)
	for default_name in default_names:
		row = frappe.db.get_value(
			"Transaction Type",
			default_name,
			["transaction_desc", "transaction_type_id"],
			as_dict=True,
		)
		if row and row.transaction_type_id:
			return {
				"transaction_type": row.transaction_desc,
				"transaction_type_id": row.transaction_type_id,
			}

	row = frappe.db.sql(
		"""
		select transaction_desc, transaction_type_id
		from `tabTransaction Type`
		where lower(transaction_desc) like %(txt)s
		order by transaction_type_id asc
		limit 1
		""",
		{"txt": "%standard rate%"},
		as_dict=True,
	)
	if row and row[0].transaction_type_id:
		return {
			"transaction_type": row[0].transaction_desc,
			"transaction_type_id": row[0].transaction_type_id,
		}

	return None


def _normalise_rate_row(row):
	return {
		"rate_id": _row_value(row, "ratE_ID", "rate_ID", "rate_id"),
		"tax_desc": cstr(_row_value(row, "ratE_DESC", "rate_DESC", "rate_desc")).strip(),
		"rate_in_p": _row_value(row, "ratE_VALUE", "rate_VALUE", "rate_value"),
	}


def _select_rate_option(options, product_uom):
	if len(options) == 1:
		return options[0], False

	uom_words = _uom_search_words(product_uom)
	for option in options:
		tax_desc = cstr(option.get("tax_desc")).lower()
		if any(word and word in tax_desc for word in uom_words):
			return option, False

	non_zero_options = [option for option in options if float(option.get("rate_in_p") or 0)]
	if len(non_zero_options) == 1:
		return non_zero_options[0], False

	return options[0], True


def _uom_search_words(product_uom):
	value = cstr(product_uom).lower()
	words = {part.strip(" ,./()") for part in value.replace("-", " ").split()}
	if "kg" in words or "kilogram" in words:
		words.update({"kg", "kilogram", "kilograms"})
	if "liter" in words or "litre" in words:
		words.update({"liter", "litre", "liters", "litres"})
	return {word for word in words if len(word) >= 2}


def _row_value(row, *keys):
	if not isinstance(row, dict):
		return None

	for key in keys:
		if key in row and row.get(key) is not None:
			return row.get(key)

	normalised = {_normalise_key(key): value for key, value in row.items()}
	for key in keys:
		value = normalised.get(_normalise_key(key))
		if value is not None:
			return value
	return None


def _normalise_key(value):
	return "".join(ch for ch in cstr(value).lower() if ch.isalnum())
