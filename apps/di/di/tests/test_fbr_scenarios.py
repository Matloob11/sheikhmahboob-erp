"""Official FBR scenario master is SN001-SN028."""

import unittest
from pathlib import Path

from di.fbr_scenarios import FBR_SCENARIOS, official_sale_types

SETTINGS_JS = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "doctype"
	/ "di_settings"
	/ "di_settings.js"
)


class TestFBRScenarios(unittest.TestCase):
	def test_all_twenty_eight_official_codes(self):
		codes = [row[0] for row in FBR_SCENARIOS]
		self.assertEqual(len(codes), 28)
		self.assertEqual(codes, [f"SN{i:03d}" for i in range(1, 29)])
		self.assertEqual(len(set(codes)), 28)

	def test_each_row_has_description_and_sale_type(self):
		for sn_no, description, sale_type in FBR_SCENARIOS:
			self.assertTrue(description, sn_no)
			self.assertTrue(sale_type, sn_no)

	def test_official_sale_types_are_unique_and_cover_scenarios(self):
		names = official_sale_types()
		self.assertEqual(names, list(dict.fromkeys(names)))
		for _sn_no, _description, sale_type in FBR_SCENARIOS:
			self.assertIn(sale_type, names)
		self.assertIn("Goods at standard rate (default)", names)
		self.assertIn("Exempt goods", names)

	def test_load_button_is_on_di_settings(self):
		js = SETTINGS_JS.read_text(encoding="utf-8")
		self.assertIn("Load FBR sale types", js)
		self.assertIn("di.api.load_fbr_sale_types", js)
