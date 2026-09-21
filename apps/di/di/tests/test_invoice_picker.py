"""Sale Tax Invoice company picker cards."""

import unittest
from types import SimpleNamespace

from di.invoice_picker import build_sale_invoice_company_cards


class TestInvoicePickerCards(unittest.TestCase):
	def test_counts_sandbox_and_production_per_company(self):
		sellers = [
			SimpleNamespace(name="Golden Ball International", seller_ntncnic="5413821", seller_province="SINDH"),
			SimpleNamespace(name="Empty Co", seller_ntncnic="", seller_province="PUNJAB"),
		]
		invoices = [
			{"seller__business_name": "Golden Ball International", "fbr_environment": "Sandbox"},
			{"seller__business_name": "Golden Ball International", "fbr_environment": "Sandbox"},
			{"seller__business_name": "Golden Ball International", "fbr_environment": "Production"},
			{"seller__business_name": "Other Co", "fbr_environment": "Sandbox"},
		]

		cards = build_sale_invoice_company_cards(sellers, invoices)

		self.assertEqual(len(cards), 2)
		self.assertEqual(cards[0]["name"], "Golden Ball International")
		self.assertEqual(cards[0]["ntn"], "5413821")
		self.assertEqual(cards[0]["sandbox"], 2)
		self.assertEqual(cards[0]["production"], 1)
		self.assertEqual(cards[1]["name"], "Empty Co")
		self.assertEqual(cards[1]["sandbox"], 0)
		self.assertEqual(cards[1]["production"], 0)

	def test_panel_user_with_one_company_opens_all_environments(self):
		from di.invoice_picker import default_invoice_selection

		companies = [{"name": "Acme", "sandbox": 9, "production": 0}]
		self.assertEqual(
			default_invoice_selection(companies, panel_user=True),
			{"company": "Acme", "environment": "All"},
		)
		self.assertEqual(default_invoice_selection(companies, panel_user=False), {"company": "Acme"})
		self.assertEqual(default_invoice_selection([], panel_user=True), {})
		self.assertEqual(
			default_invoice_selection(companies + [{"name": "Beta"}], panel_user=True),
			{},
		)

	def test_blank_environment_counts_as_sandbox(self):
		sellers = [SimpleNamespace(name="Acme", seller_ntncnic="1", seller_province="SINDH")]
		invoices = [{"seller__business_name": "Acme", "fbr_environment": ""}]

		cards = build_sale_invoice_company_cards(sellers, invoices)

		self.assertEqual(cards[0]["sandbox"], 1)
		self.assertEqual(cards[0]["production"], 0)
