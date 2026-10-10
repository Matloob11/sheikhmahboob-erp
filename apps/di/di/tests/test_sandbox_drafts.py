"""Sandbox pending invoices → validate and submit."""

import unittest
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from di.integrations.http import FBRRejected, FBRUnsentError
from di.invoice_rules import extra_rupees_per_qty
from di.sandbox_drafts import (
	_extract_scenario_codes,
	_normalize_province,
	_sandbox_item_name,
	_submit_sandbox_invoice,
	buyer_kind_for_scenario,
	classify_token,
	fed_st_probe_candidates,
	format_fbr_validation_errors,
	item_defaults_for_sale_type,
	keep_if_fbr_valid,
	recipe_for,
	recipes_for,
	resolve_sandbox_environment,
	try_fetch_fbr_scenarios,
)

SETTINGS_JS = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "doctype"
	/ "di_settings"
	/ "di_settings.js"
)


class TestSandboxDraftHelpers(unittest.TestCase):
	def test_registered_vs_unregistered_buyers(self):
		self.assertEqual(buyer_kind_for_scenario("SN001"), "Registered")
		self.assertEqual(buyer_kind_for_scenario("SN002"), "Unregistered")
		self.assertEqual(buyer_kind_for_scenario("SN026"), "Unregistered")
		self.assertEqual(buyer_kind_for_scenario("SN005"), "Registered")

	def test_steel_and_gas_use_posted_hs_codes(self):
		steel = recipe_for("SN003", "Steel melting and re-rolling")
		self.assertEqual(steel["hs_code"], "7204.4990")
		self.assertEqual(steel["uom"], "MT")
		self.assertEqual(steel["product_description"], "IRON AND STEEL")
		self.assertEqual(steel["sale_rate"], 130000)
		gas = recipe_for("SN014", "Gas to CNG stations")
		self.assertEqual(gas["hs_code"], "2711.2100")
		self.assertEqual(gas["uom"], "MMBTU")

	def test_steel_fallback_avoids_compressor_scrap_hs(self):
		rows = recipes_for("SN003", "Steel melting and re-rolling")
		self.assertEqual(rows[0]["hs_code"], "7204.4990")
		self.assertEqual(rows[0]["uom"], "MT")
		self.assertEqual(rows[1]["hs_code"], "7214.2090")
		self.assertEqual(rows[1]["uom"], "MT")
		self.assertGreaterEqual(rows[1]["sale_rate"], 202455)
		codes = [row["hs_code"] for row in rows]
		self.assertIn("7207.1210", codes)

	def test_sandbox_item_name_never_reuses_shared_catalogue(self):
		name = _sandbox_item_name(
			"Pak Defence Techno Crafts", "SN003", {"product_description": "IRON AND STEEL"}
		)
		self.assertIn("IRON AND STEEL", name)
		self.assertIn("Pak Defence Techno Crafts", name)
		self.assertNotEqual(name, "IRON AND STEEL")
		petrol = _sandbox_item_name(
			"PUNJAB P.V.C PIPE FACTORY", "SN012", {"product_description": "Petroleum Products"}
		)
		self.assertIn("Petroleum Products", petrol)
		self.assertNotEqual(petrol, "Petroleum Products")

	def test_toll_and_non_adjustable_use_official_rates(self):
		sn011 = recipe_for("SN011", "Toll Manufacturing")
		self.assertEqual(sn011["hs_code"], "7214.2090")
		self.assertEqual(sn011["uom"], "MT")
		self.assertGreaterEqual(sn011["sale_rate"], 202455)
		sn025 = recipe_for("SN025", "Non-Adjustable Supplies")
		self.assertEqual(sn025["hs_code"], "3004.9099")
		self.assertEqual(sn025["rate_in_p"], 0)
		self.assertEqual(sn025["tax_desc"], "0%")
		self.assertEqual(sn025["sro_schedule"], "EIGHTH SCHEDULE Table 1")
		self.assertEqual(sn025["sro_serial"], "81")
		self.assertEqual(item_defaults_for_sale_type("Non-Adjustable Supplies")[1], 0)

	@patch("di.sandbox_drafts._submit_one")
	def test_retries_next_recipe_on_efs_scrap_error(self, mock_submit):
		from types import SimpleNamespace

		def side_effect(*args, **_kwargs):
			recipe = args[-1]
			if recipe["hs_code"] == "7204.4990":
				raise Exception(
					"Digital Invoicing Error: You are not an EFS license holder "
					"who has imported Compressor Scrap"
				)
			return SimpleNamespace(name="STI-X", fbr_invoice_no="FBR-1")

		mock_submit.side_effect = side_effect
		doc = _submit_sandbox_invoice(
			"Pak Defence Techno Crafts",
			None,
			"SN003",
			"Sale of Steel",
			"Steel melting and re-rolling",
			"Pak Defence Techno Crafts",
		)
		self.assertEqual(doc.fbr_invoice_no, "FBR-1")
		self.assertGreaterEqual(mock_submit.call_count, 2)
		used = mock_submit.call_args.args[-1]["hs_code"]
		self.assertNotEqual(used, "7204.4990")

	def test_petroleum_recipe_uses_levy_hs_and_sro(self):
		recipe = recipe_for("SN012", "Petroleum Products")
		self.assertEqual(recipe["hs_code"], "2710.1210")
		self.assertEqual(recipe["uom"], "Liter")
		self.assertEqual(recipe["product_description"], "Petroleum Products")
		self.assertEqual(recipe["sro_schedule"], "1450(I)/2021")
		self.assertEqual(recipe["sro_serial"], "4")
		self.assertTrue(recipe["petroleum_levy"])

	def test_cement_and_chlorate_keep_fbr_rate_literals(self):
		self.assertEqual(recipe_for("SN021")["tax_desc"], "Rs.2")
		self.assertEqual(recipe_for("SN022")["tax_desc"], "18% along with rupees 60 per kilogram")
		self.assertEqual(recipe_for("SN023")["sro_serial"], "Region-I")

	def test_third_schedule_sends_a_notified_price(self):
		sn008 = recipe_for("SN008", "3rd Schedule Goods")
		self.assertEqual(sn008["fixed_rs"], 1000)
		self.assertEqual(sn008["sale_rate"], 1000)
		self.assertEqual(sn008["sro_schedule"], "")
		sn027 = recipe_for("SN027")
		self.assertEqual(sn027["reuse"], "SN008")
		self.assertEqual(sn027["fixed_rs"], 1000)
		sn024 = recipe_for("SN024", "Goods as per SRO.297(|)/2023")
		self.assertEqual(sn024["fixed_rs"], 1000)
		self.assertEqual(sn024["sale_rate"], 1000)
		self.assertEqual(sn024["rate_in_p"], 25)
		self.assertEqual(item_defaults_for_sale_type("Goods as per SRO.297(|)/2023")[4], 1000)

	def test_end_consumer_reuses_standard_items(self):
		self.assertEqual(recipe_for("SN026")["reuse"], "SN001")
		self.assertEqual(recipe_for("SN026")["hs_code"], recipe_for("SN001")["hs_code"])
		sn028 = recipe_for("SN028")
		self.assertEqual(sn028["sro_schedule"], "EIGHTH SCHEDULE Table 1")
		self.assertEqual(sn028["sro_serial"], "70")
		self.assertEqual(sn028["hs_code"], recipe_for("SN005")["hs_code"])
		self.assertEqual(sn028["rate_in_p"], 1)

	def test_chlorate_adds_sixty_rupees_per_kg(self):
		self.assertEqual(extra_rupees_per_qty("18% along with rupees 60 per kilogram"), Decimal("60"))
		self.assertEqual(extra_rupees_per_qty("18% and Rs. 80 per Liter"), Decimal("80"))
		self.assertEqual(extra_rupees_per_qty("Rs.2"), Decimal("0"))

	def test_fed_in_st_uses_budget_2026_petroleum_hs(self):
		recipe = recipe_for("SN017", "Goods (FED in ST Mode)")
		self.assertEqual(recipe["hs_code"], "2710.1240")
		self.assertEqual(recipe["uom"], "Liter")
		self.assertNotEqual(recipe["hs_code"], "4820.9000")
		defaults = item_defaults_for_sale_type("Goods (FED in ST Mode)")
		self.assertEqual(defaults[2], "2710.1240")
		self.assertEqual(defaults[3], "Liter")
		codes = [row["hs_code"] for row in recipes_for("SN017", "Goods (FED in ST Mode)")]
		self.assertIn("2710.1240", codes)
		self.assertIn("2710.1250", codes)
		self.assertIn("2710.1942", codes)
		self.assertNotIn("4820.9000", codes)
		pairs = {(hs, rate) for hs, uom, rate, _value in fed_st_probe_candidates()}
		self.assertIn(("2710.1240", "10.07%"), pairs)
		self.assertIn(("2710.1240", "18% and Rs. 80 per Liter"), pairs)
		self.assertTrue(all(uom == "Liter" for _hs, uom, _rate, _value in fed_st_probe_candidates()))

	def test_reduced_and_exempt_defaults(self):
		self.assertEqual(item_defaults_for_sale_type("Goods at Reduced Rate")[1], 1)
		self.assertEqual(item_defaults_for_sale_type("Exempt goods")[1], 0)
		self.assertEqual(item_defaults_for_sale_type("Goods at standard rate (default)")[1], 18)

	def test_extract_known_scenario_codes(self):
		codes = _extract_scenario_codes(
			{"data": [{"scenarioId": "SN001"}, {"scenarioId": "SN099"}, {"scenarioId": "SN005"}]}
		)
		self.assertEqual(codes, ["SN001", "SN005"])

	def test_province_normalises_to_seller_select(self):
		self.assertEqual(_normalize_province("Punjab"), "PUNJAB")
		self.assertEqual(_normalize_province("KPK"), "KHYBER PAKHTUNKHWA")
		self.assertEqual(_normalize_province(""), "PUNJAB")

	def test_empty_token_is_invalid(self):
		self.assertEqual(classify_token(""), "Invalid")
		self.assertEqual(classify_token("   "), "Invalid")

	def test_button_is_on_di_settings(self):
		js = SETTINGS_JS.read_text(encoding="utf-8")
		self.assertIn("Pending invoices → Submit", js)
		self.assertIn("di.api.get_sandbox_pending_scenarios", js)
		self.assertIn("di.api.create_sandbox_scenario_drafts", js)
		self.assertIn("Validate & submit", js)
		self.assertIn("Not submitted — FBR rejected", js)
		self.assertIn("scenario_ids: [sn]", js)
		self.assertNotIn("scenario_ids: ids", js)


class TestTokenClassification(unittest.TestCase):
	@patch("di.sandbox_drafts.post")
	def test_validation_error_on_sandbox_means_sandbox(self, mock_post):
		mock_post.side_effect = FBRRejected("400 validation failed")
		self.assertEqual(classify_token("tok"), "Sandbox")

	@patch("di.sandbox_drafts.post")
	def test_401_on_sandbox_then_400_on_prod_is_unknown(self, mock_post):
		def side_effect(url, *_args, **_kwargs):
			if "validateinvoicedata_sb" in url:
				raise FBRRejected("401 Unauthorized")
			raise FBRRejected("400 bad request")

		mock_post.side_effect = side_effect
		self.assertEqual(classify_token("tok"), "Unknown")

	@patch("di.sandbox_drafts.classify_token", return_value="Unknown")
	def test_sync_mode_sandbox_does_not_probe_fbr(self, mock_classify):
		self.assertEqual(resolve_sandbox_environment("tok", "Sandbox"), "Sandbox")
		mock_classify.assert_not_called()

	@patch("di.sandbox_drafts.classify_token", return_value="Production")
	def test_production_sync_mode_still_probes(self, mock_classify):
		self.assertEqual(resolve_sandbox_environment("tok", "Production"), "Production")
		mock_classify.assert_called_once()

	def test_blank_token_stays_invalid_in_sandbox_mode(self):
		self.assertEqual(resolve_sandbox_environment("  ", "Sandbox"), "Invalid")

	@patch("di.sandbox_drafts.get", side_effect=Exception("down"))
	def test_scenario_list_lookup_waits_only_a_few_seconds(self, mock_get):
		self.assertIsNone(try_fetch_fbr_scenarios("tok"))
		self.assertGreaterEqual(mock_get.call_count, 1)
		timeout = mock_get.call_args.kwargs["timeout"]
		self.assertLessEqual(timeout[0], 5)
		self.assertLessEqual(timeout[1], 8)

	@patch("di.sandbox_drafts.post")
	def test_401_on_both_means_invalid(self, mock_post):
		mock_post.side_effect = FBRRejected("401 Unauthorized")
		self.assertEqual(classify_token("tok"), "Invalid")

	@patch("di.sandbox_drafts.post")
	def test_unreachable_fbr_is_unknown_not_invalid(self, mock_post):
		mock_post.side_effect = FBRUnsentError("could not connect")
		self.assertEqual(classify_token("tok"), "Unknown")


class TestFbrValidateBeforeDraft(unittest.TestCase):
	def test_item_errors_are_shown_not_empty_top_level(self):
		message = format_fbr_validation_errors(
			{
				"validationResponse": {
					"status": "Invalid",
					"statusCode": "01",
					"error": "",
					"invoiceStatuses": [
						{
							"itemSNo": "1",
							"status": "Invalid",
							"errorCode": "0077",
							"error": "SRO schedule required",
						}
					],
				}
			}
		)
		self.assertIn("0077", message)
		self.assertIn("SRO schedule required", message)

	@patch("di.sandbox_drafts._discard_draft")
	@patch("di.integrations.sale_tax_invoice_api.validate_sale_tax_invoice")
	def test_invalid_validate_discards_the_draft(self, mock_validate, mock_discard):
		from types import SimpleNamespace

		mock_validate.return_value = {
			"validationResponse": {"status": "Invalid", "statusCode": "01", "error": "bad buyer"}
		}
		ok, reason = keep_if_fbr_valid(SimpleNamespace(name="STI-1", db_set=lambda *a, **k: None))
		self.assertFalse(ok)
		self.assertIn("bad buyer", reason)
		mock_discard.assert_called_once()

	@patch("di.sandbox_drafts._discard_draft")
	@patch("di.integrations.sale_tax_invoice_api.validate_sale_tax_invoice")
	def test_valid_validate_keeps_draft_and_does_not_post(self, mock_validate, mock_discard):
		from types import SimpleNamespace

		saved = {}
		mock_validate.return_value = {"validationResponse": {"status": "Valid", "statusCode": "00"}}
		ok, reason = keep_if_fbr_valid(
			SimpleNamespace(name="STI-1", db_set=lambda field, value, **k: saved.update({field: value}))
		)
		self.assertTrue(ok)
		self.assertEqual(reason, "")
		self.assertEqual(saved.get("sandbox_run_status"), "FBR Validated")
		mock_discard.assert_not_called()


class TestFedStLiveProbe(unittest.TestCase):
	@patch("di.sandbox_drafts._pin_fed_st_recipe")
	@patch("di.sandbox_drafts.fed_st_probe_candidates")
	@patch("di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload")
	@patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok")
	@patch("di.integrations.sale_tax_invoice_api._get_validate_url", return_value="https://fbr/validate")
	@patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="https://fbr/post")
	@patch("di.integrations.sale_tax_invoice_api._apply_success")
	@patch("di.integrations.di_api._make_request")
	def test_posts_the_first_payload_fbr_accepts(
		self,
		mock_request,
		_apply_success,
		_post_url,
		_validate_url,
		_token,
		mock_payload,
		mock_candidates,
		mock_pin,
	):
		from types import SimpleNamespace

		from di.sandbox_drafts import _probe_and_post_fed_st

		mock_payload.return_value = {
			"items": [{"quantity": 1, "valueSalesExcludingST": 100, "rate": "8%"}]
		}
		mock_candidates.return_value = [
			("2710.1240", "Liter", "8%", 8),
			("2710.1240", "Liter", "10.07%", 10.07),
		]
		valid = {"validationResponse": {"status": "Valid", "statusCode": "00"}}
		invalid = {"validationResponse": {"status": "Invalid", "statusCode": "01"}}
		posted = {"invoiceNumber": "FBR-SN017", "validationResponse": valid["validationResponse"]}
		mock_request.side_effect = [invalid, valid, posted]
		doc = SimpleNamespace(fbr_invoice_no="", db_set=lambda *a, **k: None)
		number = _probe_and_post_fed_st(doc, "FAIZ", "Goods (FED in ST Mode)", "FAIZ")
		self.assertEqual(number, "FBR-SN017")
		self.assertEqual(mock_request.call_count, 3)
		posted_payload = mock_request.call_args_list[2].args[1]
		self.assertEqual(posted_payload["items"][0]["rate"], "10.07%")
		self.assertEqual(posted_payload["items"][0]["hsCode"], "2710.1240")
		mock_pin.assert_called_once()

	@patch("di.sandbox_drafts.time.monotonic", side_effect=[0, 1000])
	@patch("di.sandbox_drafts.fed_st_probe_candidates")
	@patch("di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload")
	@patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok")
	@patch("di.integrations.sale_tax_invoice_api._get_validate_url", return_value="https://fbr/validate")
	@patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="https://fbr/post")
	@patch("di.integrations.di_api._make_request")
	def test_probe_stops_when_the_time_budget_is_spent(
		self,
		mock_request,
		_post_url,
		_validate_url,
		_token,
		mock_payload,
		mock_candidates,
		_clock,
	):
		from types import SimpleNamespace

		from di.sandbox_drafts import _probe_and_post_fed_st

		mock_payload.return_value = {
			"items": [{"quantity": 1, "valueSalesExcludingST": 100, "rate": "8%"}]
		}
		mock_candidates.return_value = [("2710.1240", "Liter", "8%", 8)]
		doc = SimpleNamespace(fbr_invoice_no="", db_set=lambda *a, **k: None)
		self.assertIsNone(_probe_and_post_fed_st(doc, "FAIZ", "Goods (FED in ST Mode)", "FAIZ"))
		mock_request.assert_not_called()

	@patch("di.sandbox_drafts.fed_st_probe_candidates")
	@patch("di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload")
	@patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok")
	@patch("di.integrations.sale_tax_invoice_api._get_validate_url", return_value="https://fbr/validate")
	@patch("di.integrations.sale_tax_invoice_api._get_post_url", return_value="https://fbr/post")
	@patch("di.integrations.di_api._make_request")
	def test_uncertain_post_does_not_try_the_next_rate(
		self,
		mock_request,
		_post_url,
		_validate_url,
		_token,
		mock_payload,
		mock_candidates,
	):
		from types import SimpleNamespace

		from di.integrations.http import FBRUncertainError
		from di.sandbox_drafts import _probe_and_post_fed_st

		mock_payload.return_value = {
			"items": [{"quantity": 1, "valueSalesExcludingST": 100, "rate": "8%"}]
		}
		mock_candidates.return_value = [
			("2710.1240", "Liter", "8%", 8),
			("2710.1250", "Liter", "10.07%", 10.07),
		]
		valid = {"validationResponse": {"status": "Valid", "statusCode": "00"}}
		mock_request.side_effect = [valid, FBRUncertainError("read timed out")]
		doc = SimpleNamespace(fbr_invoice_no="", db_set=lambda *a, **k: None)
		with self.assertRaises(FBRUncertainError):
			_probe_and_post_fed_st(doc, "FAIZ", "Goods (FED in ST Mode)", "FAIZ")
		self.assertEqual(mock_request.call_count, 2)
