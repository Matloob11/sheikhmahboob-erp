"""Pure assistant rules: no site, no network."""

import unittest

from di.ai import rules


class TestTaxIds(unittest.TestCase):
	def test_ntn_and_cnic_shapes(self):
		self.assertEqual(rules.normalize_tax_id("4739616"), ("4739616", "NTN"))
		self.assertEqual(rules.normalize_tax_id("9020028-3"), ("9020028", "NTN"))
		self.assertEqual(rules.normalize_tax_id("36302-4907545-9"), ("3630249075459", "CNIC"))
		self.assertEqual(rules.normalize_tax_id("90200283"), ("90200283", None))
		self.assertEqual(rules.normalize_tax_id("12345"), ("12345", None))
		self.assertEqual(rules.classify_tax_id(""), None)

	def test_buyer_identity_errors(self):
		self.assertIsNone(rules.buyer_identity_error("Registered", "4739616"))
		self.assertIsNone(rules.buyer_identity_error("Registered", "9020028-3"))
		self.assertIsNone(rules.buyer_identity_error("Unregistered", "3630249075459"))
		self.assertIn("required", rules.buyer_identity_error("Unregistered", ""))
		self.assertIn("placeholder", rules.buyer_identity_error("Unregistered", "0000000000000"))
		self.assertIn("check digit", rules.buyer_identity_error("Registered", "90200283"))
		self.assertIn("13 digits", rules.buyer_identity_error("Registered", "123"))
		self.assertIn("registration_type", rules.buyer_identity_error("Walk-in", "4739616"))

	def test_mask_identity(self):
		self.assertEqual(rules.mask_identity("3630249075459"), "*********5459")
		self.assertEqual(rules.mask_identity("123"), "123")


class TestNormalisers(unittest.TestCase):
	def test_province_aliases(self):
		self.assertEqual(rules.normalize_province("punjab"), "PUNJAB")
		self.assertEqual(rules.normalize_province("KPK"), "KHYBER PAKHTUNKHWA")
		self.assertEqual(rules.normalize_province("Islamabad"), "CAPITAL TERRITORY")
		self.assertEqual(rules.normalize_province("Gilgit-Baltistan"), "GILGIT BALTISTAN")
		self.assertIsNone(rules.normalize_province("Lahore"))
		self.assertIsNone(rules.normalize_province(""))

	def test_uom_aliases_map_to_fbr_strings(self):
		self.assertEqual(rules.normalize_uom("pcs"), "Numbers, pieces, units")
		self.assertEqual(rules.normalize_uom("Numbers, Pieces, Units"), "Numbers, pieces, units")
		self.assertEqual(rules.normalize_uom("kgs"), "KG")
		self.assertEqual(rules.normalize_uom("Litre"), "Liter")
		self.assertEqual(rules.normalize_uom("set"), "SET")
		self.assertEqual(rules.normalize_uom("MT"), "MT")
		self.assertIsNone(rules.normalize_uom("cartons"))

	def test_rate_parsing(self):
		self.assertEqual(rules.parse_rate("18%"), ("18%", 18.0))
		self.assertEqual(rules.parse_rate(18), ("18%", 18.0))
		self.assertEqual(rules.parse_rate("1.5"), ("1.5%", 1.5))
		self.assertEqual(rules.parse_rate("0"), ("0%", 0.0))
		self.assertIsNone(rules.parse_rate("18% along with rupees 60 per kilogram"))
		self.assertIsNone(rules.parse_rate("120"))
		self.assertIsNone(rules.parse_rate(""))

	def test_leading_percent_and_plain_rate(self):
		self.assertEqual(rules.leading_percent("18% along with rupees 60 per kilogram"), 18.0)
		self.assertEqual(rules.leading_percent("1.5 % extra"), 1.5)
		self.assertIsNone(rules.leading_percent("Rs. 60 per kg"))
		self.assertIsNone(rules.leading_percent(""))
		self.assertEqual(rules.plain_rate("18%", 5), 18.0)
		self.assertEqual(rules.plain_rate("", "18"), 18.0)
		self.assertIsNone(rules.plain_rate("18% along with rupees 60 per kilogram", 18))
		self.assertIsNone(rules.plain_rate("", "abc"))
		self.assertIsNone(rules.plain_rate("", None))

	def test_flat_rupee_rates_are_recognised(self):
		self.assertTrue(rules.is_flat_rupee_rate("Rs.2"))
		self.assertTrue(rules.is_flat_rupee_rate("Rs 200"))
		self.assertTrue(rules.is_flat_rupee_rate("rupees 60"))
		self.assertFalse(rules.is_flat_rupee_rate("18%"))
		self.assertFalse(rules.is_flat_rupee_rate("18% along with rupees 60 per kilogram"))
		self.assertFalse(rules.is_flat_rupee_rate(""))

	def test_quantity_and_amount(self):
		self.assertEqual(rules.parse_quantity("3"), 3.0)
		self.assertIsNone(rules.parse_quantity(0))
		self.assertIsNone(rules.parse_quantity("abc"))
		self.assertEqual(rules.parse_amount("4500.005"), 4500.01)
		self.assertIsNone(rules.parse_amount(-1))

	def test_hs_code_normalisation(self):
		self.assertEqual(rules.normalize_hs_code("84212100"), "8421.2100")
		self.assertEqual(rules.normalize_hs_code("8421 2100"), "8421.2100")
		self.assertEqual(rules.normalize_hs_code(" 8421.2100 "), "8421.2100")
		self.assertEqual(rules.normalize_hs_code("8421"), "8421")
		self.assertEqual(rules.normalize_hs_code("water  filter"), "water filter")


class TestScenarios(unittest.TestCase):
	def test_standard_rate_splits_by_buyer_type(self):
		self.assertEqual(rules.scenario_for("Goods at standard rate (default)", "Registered"), "SN001")
		self.assertEqual(rules.scenario_for("Goods at standard rate (default)", "Unregistered"), "SN002")
		self.assertEqual(rules.scenario_for("", "Registered"), "SN001")

	def test_reduced_and_third_schedule_split_by_buyer_type(self):
		self.assertEqual(rules.scenario_for("Goods at Reduced Rate", "Registered"), "SN005")
		self.assertEqual(rules.scenario_for("Goods at Reduced Rate", "Unregistered"), "SN028")
		self.assertEqual(rules.scenario_for("3rd Schedule Goods", "Registered"), "SN008")
		self.assertEqual(rules.scenario_for("3rd Schedule Goods", "Unregistered"), "SN027")

	def test_other_sale_types_use_their_official_scenario(self):
		self.assertEqual(rules.scenario_for("Exempt goods", "Unregistered"), "SN006")
		self.assertEqual(rules.scenario_for("Goods at zero-rate", "Registered"), "SN007")
		self.assertEqual(rules.scenario_for("Services", "Registered"), "SN019")
		self.assertEqual(rules.scenario_for("Petroleum Products", "Unregistered"), "SN012")
		self.assertIsNone(rules.scenario_for("Not a sale type", "Registered"))

	def test_cotton_ginners_need_a_registered_buyer(self):
		self.assertEqual(rules.scenario_for("Cotton ginners", "Registered"), "SN009")
		self.assertIsNone(rules.scenario_for("Cotton ginners", "Unregistered"))

	def test_explicit_scenario_must_match_the_buyer(self):
		self.assertTrue(rules.scenario_matches_buyer("SN001", "Registered"))
		self.assertFalse(rules.scenario_matches_buyer("SN001", "Unregistered"))
		self.assertTrue(rules.scenario_matches_buyer("SN002", "Unregistered"))
		self.assertTrue(rules.scenario_matches_buyer("SN006", "Unregistered"))
		self.assertEqual(rules.scenario_buyer_kind("SN027"), "Unregistered")
		self.assertEqual(rules.scenario_buyer_kind("SN012"), "any")

	def test_registered_halves_of_the_pairs_refuse_unregistered_buyers(self):
		# SN005 / SN008 are the registered-buyer scenarios; SN028 / SN027 are their twins.
		for sn_no in ("SN005", "SN008"):
			self.assertEqual(rules.scenario_buyer_kind(sn_no), "Registered")
			self.assertTrue(rules.scenario_matches_buyer(sn_no, "Registered"))
			self.assertFalse(rules.scenario_matches_buyer(sn_no, "Unregistered"))

	def test_sale_types_match_without_regard_to_case(self):
		self.assertEqual(rules.canonical_sale_type("goods at reduced rate"), "Goods at Reduced Rate")
		self.assertEqual(
			rules.canonical_sale_type("  GOODS AT STANDARD RATE (DEFAULT) "), rules.STANDARD_SALE_TYPE
		)
		self.assertIsNone(rules.canonical_sale_type("not a type"))
		self.assertIsNone(rules.canonical_sale_type(""))
		self.assertEqual(rules.scenario_for("GOODS AT STANDARD RATE (DEFAULT)", "Registered"), "SN001")
		self.assertEqual(rules.scenario_for("goods at reduced rate", "Unregistered"), "SN028")

	def test_sale_type_for_scenario(self):
		self.assertEqual(rules.sale_type_for_scenario("sn012"), "Petroleum Products")
		self.assertEqual(rules.sale_type_for_scenario("SN999"), "")


class TestSaleTypeInference(unittest.TestCase):
	def test_explicit_transaction_type_wins(self):
		self.assertEqual(rules.infer_sale_type("Services", "16%", 16), ("Services", ""))

	def test_unambiguous_cases(self):
		self.assertEqual(rules.infer_sale_type("", "18%", 18)[0], rules.STANDARD_SALE_TYPE)
		self.assertEqual(rules.infer_sale_type("", "", 18)[0], rules.STANDARD_SALE_TYPE)
		self.assertEqual(rules.infer_sale_type("", "Exempt", 0)[0], rules.EXEMPT_SALE_TYPE)

	def test_ambiguous_rates_are_refused(self):
		sale_type, reason = rules.infer_sale_type("", "0%", 0)
		self.assertIsNone(sale_type)
		self.assertIn("ask", reason)
		self.assertIsNone(rules.infer_sale_type("", "5%", 5)[0])

	def test_compound_literals_never_become_standard_rate(self):
		# Potassium Chlorate (SN022) and FED-in-ST (SN017) items carry 18 in rate_in_p, but
		# they are not 18% items; FBR rejects them as standard rate (0046/0104).
		for literal in ("18% along with rupees 60 per kilogram", "18% and Rs. 80 per Liter"):
			sale_type, reason = rules.infer_sale_type("", literal, 18)
			self.assertIsNone(sale_type, literal)
			self.assertIn("literal", reason)
			self.assertIn("18%", rules.standard_rate_mismatch(rules.STANDARD_SALE_TYPE, literal, 18))

	def test_standard_rate_must_be_a_plain_18(self):
		self.assertIsNone(rules.standard_rate_mismatch(rules.STANDARD_SALE_TYPE, "18%", 18))
		self.assertIsNone(rules.standard_rate_mismatch(rules.STANDARD_SALE_TYPE, "", 18))
		self.assertIn("18%", rules.standard_rate_mismatch(rules.STANDARD_SALE_TYPE, "5%", 5))
		self.assertIn("18%", rules.standard_rate_mismatch(rules.STANDARD_SALE_TYPE, "Exempt", 0))
		self.assertIn("18%", rules.standard_rate_mismatch("goods at standard rate (default)", "5%", 5))
		self.assertIsNone(rules.standard_rate_mismatch("Goods at Reduced Rate", "5%", 5))


class TestNames(unittest.TestCase):
	def test_unique_name_adds_seller_then_number(self):
		taken = {"Water Filter", "Water Filter (ACME)"}
		self.assertEqual(
			rules.unique_name("Water Filter", taken.__contains__, "ACME"), "Water Filter (ACME) 2"
		)
		self.assertEqual(rules.unique_name("Pump", taken.__contains__, "ACME"), "Pump")

	def test_clip_keeps_short_text_and_marks_long_text(self):
		self.assertEqual(rules.clip("  a   b "), "a b")
		self.assertTrue(rules.clip("x" * 400, 50).endswith("…"))
		self.assertEqual(len(rules.clip("x" * 400, 50)), 50)

	def test_error_hints_cover_the_codes_the_prompt_names(self):
		for code in ("0052", "0053", "0058", "0077", "0078", "0090", "0099", "0106"):
			self.assertIn(code, rules.FBR_ERROR_HINTS)
