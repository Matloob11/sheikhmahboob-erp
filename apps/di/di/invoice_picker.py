"""Company → environment picker data for the Sale Tax Invoice list."""

from __future__ import annotations

from collections import Counter


def _text(row, *keys):
	for key in keys:
		if isinstance(row, dict):
			value = row.get(key)
		else:
			value = getattr(row, key, None)
		if value not in (None, ""):
			return str(value)
	return ""


def build_sale_invoice_company_cards(sellers, invoices):
	"""Group invoice counts onto seller rows. Pure helper for tests."""
	counts = Counter()
	for invoice in invoices or []:
		seller = _text(invoice, "seller__business_name")
		environment = _text(invoice, "fbr_environment") or "Sandbox"
		if seller:
			counts[(seller, environment)] += 1

	cards = []
	for seller in sellers or []:
		name = _text(seller, "name")
		if not name:
			continue
		cards.append(
			{
				"name": name,
				"ntn": _text(seller, "seller_ntncnic"),
				"province": _text(seller, "seller_province"),
				"sandbox": int(counts.get((name, "Sandbox"), 0)),
				"production": int(counts.get((name, "Production"), 0)),
			}
		)
	return cards


def default_invoice_selection(companies, panel_user: bool = False) -> dict:
	"""One assigned company: panel users open Production invoices only."""
	if len(companies or []) != 1:
		return {}
	name = companies[0].get("name") if isinstance(companies[0], dict) else getattr(companies[0], "name", None)
	if not name:
		return {}
	if panel_user:
		return {"company": name, "environment": "Production"}
	return {"company": name}


def get_sale_invoice_company_cards():
	"""Sellers the user can see, with sandbox/production invoice counts."""
	import frappe

	from di.panel import is_panel_user

	frappe.has_permission("Seller Or Company", "read", throw=True)
	frappe.has_permission("Sale Tax Invoice", "read", throw=True)

	sellers = frappe.get_list(
		"Seller Or Company",
		fields=["name", "seller_ntncnic", "seller_province"],
		order_by="name asc",
		limit_page_length=0,
	)
	invoices = frappe.get_list(
		"Sale Tax Invoice",
		fields=["seller__business_name", "fbr_environment"],
		limit_page_length=0,
	)
	companies = build_sale_invoice_company_cards(sellers, invoices)
	panel_user = is_panel_user()
	return {
		"companies": companies,
		"panel_user": panel_user,
		"default_selection": default_invoice_selection(companies, panel_user),
	}
