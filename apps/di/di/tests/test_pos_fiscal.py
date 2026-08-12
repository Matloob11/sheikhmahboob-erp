"""POS fiscalisation logic, with no network and no database.

This module handles money and files with FBR, and none of it had ever run: it is
reachable only when a POS Profile has FBR enabled, and none is configured. These
cover the parts that can be exercised in isolation — identifier splitting,
payment-mode mapping, tax derivation, sanitisation — so a mistake there is caught
before it reaches a live counter.

The end-to-end path still needs a sandbox POS ID and token; see REVIEW.md.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import frappe

from di import constants
from di.integrations import pos_fiscal


def _frappe_is_bound():
	"""True when a site is initialised.

	Two things need one. frappe.db is a thread-local proxy that raises until a
	site is bound, and — less obviously — frappe.utils.flt returns 0.0 whenever a
	precision is passed without a site, because rounding reads the site's number
	format. Anything asserting on a rounded figure would otherwise "fail" against
	perfectly correct code.
	"""
	try:
		return bool(frappe.local.site)
	except Exception:
		return False


needs_site = unittest.skipUnless(
	_frappe_is_bound(), "needs a bound Frappe site: frappe.db access and flt precision"
)


class TestTaxIdentifierSplit(unittest.TestCase):
	"""FBR wants an NTN or a CNIC, never both, and they are told apart by shape."""

	def test_seven_digit_ntn_with_check_digit(self):
		self.assertEqual(pos_fiscal._split_tax_identifier("1234567-8"), ("1234567-8", None))

	def test_thirteen_digit_cnic_is_not_reported_as_an_ntn(self):
		ntn, cnic = pos_fiscal._split_tax_identifier("35201-1234567-1")
		self.assertIsNone(ntn)
		self.assertEqual(cnic, "35201-1234567-1")

	def test_undashed_cnic_is_recognised(self):
		ntn, cnic = pos_fiscal._split_tax_identifier("3520112345671")
		self.assertIsNone(ntn)
		self.assertEqual(cnic, "3520112345671")

	def test_blank_gives_neither(self):
		self.assertEqual(pos_fiscal._split_tax_identifier(""), (None, None))
		self.assertEqual(pos_fiscal._split_tax_identifier(None), (None, None))


class TestSanitise(unittest.TestCase):
	def test_control_characters_are_stripped(self):
		self.assertEqual(pos_fiscal._sanitize("AB\x00C\x1fD"), "ABCD")

	def test_length_is_capped(self):
		self.assertEqual(pos_fiscal._sanitize("abcdef", 3), "abc")

	def test_whitespace_only_becomes_none(self):
		self.assertIsNone(pos_fiscal._sanitize("   "))


class TestExtractValue(unittest.TestCase):
	"""FBR is inconsistent about casing, so responses are read by trying keys."""

	def test_first_present_key_wins(self):
		data = {"Response": "", "Message": "second", "message": "third"}
		self.assertEqual(pos_fiscal._extract_value(data, "Response", "Message", "message"), "second")

	def test_missing_returns_the_default(self):
		self.assertEqual(pos_fiscal._extract_value({}, "Code", default="x"), "x")

	def test_non_dict_returns_the_default(self):
		self.assertEqual(pos_fiscal._extract_value("nope", "Code", default="x"), "x")


class TestPaymentMode(unittest.TestCase):
	def _resolve(self, payments, configured=None):
		# Replace the whole frappe.db attribute rather than reaching through it:
		# it is a thread-local proxy and dereferencing it without a site raises.
		fake_db = SimpleNamespace(get_value=lambda *args, **kwargs: configured)
		with patch.object(pos_fiscal.frappe, "db", fake_db):
			return pos_fiscal._resolve_payment_mode({"payments": payments})

	def test_no_payment_rows_is_cash(self):
		self.assertEqual(self._resolve([]), constants.PAYMENT_MODE_CASH)

	def test_two_paid_rows_is_mixed(self):
		payments = [{"mode_of_payment": "Cash", "amount": 5}, {"mode_of_payment": "Card", "amount": 5}]
		self.assertEqual(self._resolve(payments), constants.PAYMENT_MODE_MIXED)

	def test_zero_value_rows_do_not_make_it_mixed(self):
		payments = [{"mode_of_payment": "Cash", "amount": 100}, {"mode_of_payment": "Card", "amount": 0}]
		self.assertEqual(self._resolve(payments), constants.PAYMENT_MODE_CASH)

	def test_configured_code_beats_the_name_guess(self):
		payments = [{"mode_of_payment": "Cash", "amount": 100}]
		self.assertEqual(self._resolve(payments, configured="6"), constants.PAYMENT_MODE_CHEQUE)

	def test_name_is_used_when_nothing_is_configured(self):
		payments = [{"mode_of_payment": "Visa Card", "amount": 100}]
		self.assertEqual(self._resolve(payments), constants.PAYMENT_MODE_CARD)

	def test_unmappable_name_is_refused_rather_than_guessed(self):
		"""Silently sending the wrong code would misreport how a sale was paid."""
		payments = [{"mode_of_payment": "Crypto", "amount": 100}]
		with self.assertRaises(pos_fiscal.POSFiscalError):
			self._resolve(payments)


@needs_site
class TestItemTax(unittest.TestCase):
	def test_tax_is_derived_from_the_gross_and_net_difference(self):
		item = {"base_amount": 1180, "base_net_amount": 1000}
		charged, rate = pos_fiscal._resolve_item_tax(item, {}, 1000)
		self.assertEqual(charged, 180)
		self.assertEqual(rate, 18.0)

	def test_item_tax_rate_json_is_summed(self):
		item = {"item_tax_rate": '{"Sales Tax": 17, "Further Tax": 1}'}
		charged, rate = pos_fiscal._resolve_item_tax(item, {}, 1000)
		self.assertEqual(rate, 18.0)
		self.assertEqual(charged, 180.0)

	def test_percentage_tax_rows_on_the_invoice_are_used_as_a_fallback(self):
		doc = {"taxes": [{"charge_type": "On Net Total", "rate": 18}]}
		charged, rate = pos_fiscal._resolve_item_tax({}, doc, 500)
		self.assertEqual(rate, 18.0)
		self.assertEqual(charged, 90.0)

	def test_fixed_amount_tax_rows_are_not_treated_as_a_percentage(self):
		doc = {"taxes": [{"charge_type": "Actual", "rate": 50}]}
		_charged, rate = pos_fiscal._resolve_item_tax({}, doc, 500)
		self.assertEqual(rate, 0.0)
