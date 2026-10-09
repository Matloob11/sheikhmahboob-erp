"""Tool catalogue and the checks that run before the controller sees anything.

frappe is imported for real (as the other site-less tests do) and the module's
`frappe` reference is replaced by a mock per test, so nothing touches a site.
"""

import datetime
import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from di.ai import rules, tools
from di.ai.config import AISettings
from di.constants import SRO_REQUIRED_SALE_TYPES

FIXED_NOW = datetime.datetime(2026, 10, 9, 12, 0, 0)
STANDARD = rules.STANDARD_SALE_TYPE
SALE_TYPES = (
	STANDARD,
	"Cement /Concrete Block",
	"3rd Schedule Goods",
	"Goods at Reduced Rate",
	"Exempt goods",
	"Potassium Chlorate",
)


def fake_frappe(**overrides):
	fake = MagicMock()
	fake.ValidationError = frappe.ValidationError
	fake.session = SimpleNamespace(user="clerk@example.com")
	fake.utils = frappe.utils
	fake.get_traceback = lambda: "traceback"
	fake.log_error.return_value = SimpleNamespace(name="ERR-1")
	for key, value in overrides.items():
		setattr(fake, key, value)
	return fake


def canonical_sale_type(name):
	"""What frappe.db.get_value("Sale Type", name, "name") answers: the stored spelling, case-insensitively."""
	return next((s for s in SALE_TYPES if s.lower() == str(name or "").lower()), None)


def walk_schema(schema, path="root"):
	"""Every object in a strict schema lists all properties as required and forbids extras."""
	if not isinstance(schema, dict):
		return
	if schema.get("type") == "object" or "properties" in schema:
		assert schema.get("additionalProperties") is False, f"{path}: additionalProperties must be false"
		properties = schema.get("properties") or {}
		assert set(schema.get("required") or []) == set(properties), (
			f"{path}: required must list every property"
		)
		for key, value in properties.items():
			walk_schema(value, f"{path}.{key}")
	if "items" in schema:
		walk_schema(schema["items"], f"{path}[]")


class TestCatalogue(unittest.TestCase):
	def test_every_tool_is_strict_and_complete(self):
		definitions = tools.tool_definitions(AISettings(allow_fbr_lookups=True, allow_fbr_validate=True))
		names = {d["name"] for d in definitions}
		self.assertIn("create_draft_invoice", names)
		self.assertIn("update_tax_item", names)
		self.assertIn("check_buyer_registration", names)
		for definition in definitions:
			self.assertEqual(definition["type"], "function")
			self.assertTrue(definition["strict"])
			self.assertTrue(definition["description"])
			walk_schema(definition["parameters"], definition["name"])

	def test_fbr_tools_follow_the_settings(self):
		names = {
			d["name"]
			for d in tools.tool_definitions(AISettings(allow_fbr_lookups=False, allow_fbr_validate=False))
		}
		self.assertNotIn("lookup_fbr_uom", names)
		self.assertNotIn("check_buyer_registration", names)
		self.assertNotIn("validate_with_fbr", names)
		self.assertIn("search_buyers", names)

	def test_fewer_than_twenty_tools(self):
		self.assertLess(len(tools.TOOLS), 20)


class TestRunTool(unittest.TestCase):
	def test_unknown_tool(self):
		self.assertFalse(tools.run_tool("nope", {})["ok"])

	def test_tool_error_becomes_a_message_and_rolls_back(self):
		fake = fake_frappe()
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "fixed_seller", return_value=None),
			patch.object(tools, "search_hs_codes", side_effect=tools.ToolError("say this")),
		):
			result = tools.run_tool("search_hs_codes", {"query": "x", "limit": 5})
		self.assertEqual(result["ok"], False)
		self.assertEqual(result["error"], "say this")
		fake.db.rollback.assert_called_once()
		fake.log_error.assert_not_called()

	def test_controller_validation_errors_reach_the_model_clipped(self):
		fake = fake_frappe()
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "fixed_seller", return_value=None),
			patch.object(
				tools,
				"search_hs_codes",
				side_effect=frappe.ValidationError("Seller / Business Name is required " + "x" * 600),
			),
		):
			result = tools.run_tool("search_hs_codes", {"query": "x", "limit": 5})
		self.assertFalse(result["ok"])
		self.assertTrue(result["error"].startswith("Seller / Business Name is required"))
		self.assertLessEqual(len(result["error"]), 400)
		fake.db.rollback.assert_called_once()
		fake.log_error.assert_not_called()

	def test_unexpected_exception_is_logged_not_leaked(self):
		fake = fake_frappe()
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "fixed_seller", return_value=None),
			patch.object(tools, "search_hs_codes", side_effect=RuntimeError("secret sql text")),
		):
			result = tools.run_tool("search_hs_codes", {"query": "x", "limit": 5})
		self.assertFalse(result["ok"])
		self.assertNotIn("secret sql text", result["error"])
		self.assertIn("ERR-1", result["error"])
		fake.log_error.assert_called_once()
		fake.db.rollback.assert_called_once()

	def test_single_seller_is_injected_over_the_models_choice(self):
		captured = {}

		def fake_search(seller, query, settings=None):
			captured["seller"] = seller
			return {"ok": True}

		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "fixed_seller", return_value="Acme"),
			patch.object(tools, "search_buyers", fake_search),
		):
			tools.run_tool("search_buyers", {"seller": "Other Co", "query": ""})
		self.assertEqual(captured["seller"], "Acme")

	def test_unknown_arguments_are_dropped(self):
		captured = {}

		def fake_search(query, limit=10, settings=None):
			captured.update({"query": query, "limit": limit})
			return {"ok": True}

		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "fixed_seller", return_value=None),
			patch.object(tools, "search_hs_codes", fake_search),
		):
			tools.run_tool("search_hs_codes", {"query": "pump", "limit": 3, "docstatus": 1})
		self.assertEqual(captured, {"query": "pump", "limit": 3})

	def test_switched_off_tools_refuse_at_run_time(self):
		# The catalogue drops them, but a replayed or hallucinated call must still be refused.
		off = AISettings(allow_fbr_lookups=False, allow_fbr_validate=False)
		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "fixed_seller", return_value=None),
			patch.object(tools, "require_seller", side_effect=AssertionError("must not run")),
		):
			for name, args in (
				("lookup_fbr_uom", {"hs_code": "8421.2100", "seller": "Acme"}),
				("check_buyer_registration", {"ntn_cnic": "4739616", "seller": "Acme"}),
				("validate_with_fbr", {"name": "STI-0400"}),
			):
				result = tools.run_tool(name, args, off)
				self.assertFalse(result["ok"], name)
				self.assertIn("switched off", result["error"], name)


class TestEnvironment(unittest.TestCase):
	def test_panel_users_cannot_ask_for_sandbox(self):
		with patch.object(tools, "current_user_role", return_value="DI Panel User"):
			self.assertEqual(
				tools._environment_for_user(None, AISettings(default_environment="Sandbox")), "Production"
			)
			with self.assertRaises(tools.ToolError):
				tools._environment_for_user("Sandbox", AISettings())

	def test_admins_follow_the_request_then_the_default(self):
		with patch.object(tools, "current_user_role", return_value="System Manager"):
			self.assertEqual(
				tools._environment_for_user("sandbox", AISettings(default_environment="Production")),
				"Sandbox",
			)
			self.assertEqual(
				tools._environment_for_user(None, AISettings(default_environment="Sandbox")), "Sandbox"
			)
			with self.assertRaises(tools.ToolError):
				tools._environment_for_user("staging", AISettings())


class TestRequireSeller(unittest.TestCase):
	def test_denies_sellers_outside_the_allow_list(self):
		fake = fake_frappe()
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "allowed_sellers", return_value=["Acme", "Beta"]),
		):
			with self.assertRaises(tools.ToolError) as ctx:
				tools.require_seller("Gamma")
		self.assertIn("Allowed sellers: Acme, Beta", str(ctx.exception))
		fake.has_permission.assert_not_called()

	def test_matches_case_insensitively_and_returns_the_stored_name(self):
		fake = fake_frappe()
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "allowed_sellers", return_value=["Acme"]),
		):
			self.assertEqual(tools.require_seller(" acme "), "Acme")
		fake.has_permission.assert_called_once_with("Seller Or Company", "read", doc="Acme")

	def test_framework_permission_is_checked_too(self):
		fake = fake_frappe()
		fake.has_permission.return_value = False
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "allowed_sellers", return_value=["Acme"]),
			self.assertRaises(tools.ToolError),
		):
			tools.require_seller("Acme")

	def test_no_sellers_says_none(self):
		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "allowed_sellers", return_value=[]),
			self.assertRaises(tools.ToolError) as ctx,
		):
			tools.require_seller("Acme")
		self.assertIn("none", str(ctx.exception))


class TestFbrRows(unittest.TestCase):
	def test_unwraps_the_usual_envelopes_with_the_short_timeout(self):
		for body, expected in (
			({"data": [1]}, [1]),
			({"result": [2]}, [2]),
			({"foo": 1}, [{"foo": 1}]),
			([3], [3]),
			("x", []),
		):
			with patch("di.integrations.http.get", return_value=body) as get:
				self.assertEqual(tools._fbr_rows("https://u", "tok", "ctx", {"a": 1}), expected)
			get.assert_called_once_with(
				"https://u", "tok", "ctx", params={"a": 1}, timeout=tools.LOOKUP_TIMEOUT
			)

	def test_post_and_fbr_errors(self):
		from di.integrations.http import FBRUnsentError

		with patch("di.integrations.http.post", return_value={"data": [{"ok": 1}]}) as post:
			self.assertEqual(
				tools._fbr_rows("https://u", "tok", "ctx", None, method="POST", body={"registrationNo": "1"}),
				[{"ok": 1}],
			)
		post.assert_called_once_with(
			"https://u", "tok", {"registrationNo": "1"}, "ctx", timeout=tools.LOOKUP_TIMEOUT
		)
		with (
			patch("di.integrations.http.get", side_effect=FBRUnsentError("FBR did not answer")),
			self.assertRaises(tools.ToolError) as ctx,
		):
			tools._fbr_rows("https://u", "tok", "UOM for 8421.2100", {})
		self.assertIn("UOM for 8421.2100", str(ctx.exception))

	def test_lookups_are_capped_per_turn(self):
		settings = AISettings(counters={"lookups": tools.LOOKUP_CALLS_PER_TURN})
		with patch("di.integrations.http.get") as get, self.assertRaises(tools.ToolError) as ctx:
			tools._fbr_rows("https://u", "tok", "ctx", {}, settings=settings)
		get.assert_not_called()
		self.assertIn("Too many FBR lookups", str(ctx.exception))


class TestReferenceCaching(unittest.TestCase):
	def _fake(self, can_write, cached=""):
		fake = fake_frappe()
		fake.has_permission.return_value = can_write
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: (
			cached if doctype == "HS Code" else None
		)
		fake.db.exists.side_effect = lambda doctype, name=None: doctype == "HS Uom"
		return fake

	def _uoms(self, fake, rows):
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "seller_token", return_value="tok"),
			patch.object(tools, "effective_environment", return_value="Production"),
			patch.object(tools, "_fbr_rows", return_value=rows),
		):
			return tools._fbr_uoms("2711.2100", "Acme", AISettings())

	def test_single_answer_is_cached_only_by_a_user_who_may_write_hs_code(self):
		fake = self._fake(can_write=False)
		self.assertEqual(self._uoms(fake, [{"description": "KG"}]), ["KG"])
		fake.db.set_value.assert_not_called()
		fake = self._fake(can_write=True)
		self.assertEqual(self._uoms(fake, [{"description": "KG"}, {"DESCRIPTION": "KG"}]), ["KG"])
		fake.db.set_value.assert_called_once_with("HS Code", "2711.2100", "uom", "KG", update_modified=False)
		fake.db.commit.assert_called_once()

	def test_several_answers_are_never_cached(self):
		fake = self._fake(can_write=True)
		self.assertEqual(self._uoms(fake, [{"description": "MMBTU"}, {"description": "KG"}]), ["MMBTU", "KG"])
		fake.db.set_value.assert_not_called()

	def _schedules(self, fake, rows):
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "require_seller", lambda s: s),
			patch.object(tools, "seller_token", return_value="tok"),
			patch.object(tools, "effective_environment", return_value="Production"),
			patch.object(tools, "_province_code", return_value=7),
			patch.object(tools, "_reference_date", return_value="09-Oct-2026"),
			patch.object(tools, "_fbr_rows", return_value=rows),
		):
			return tools.lookup_sro_schedules(3, "Acme", settings=AISettings())

	def test_schedules_are_saved_only_with_write_access(self):
		rows = [{"srO_DESC": "EIGHTH SCHEDULE Table 1", "srO_ID": 3}, {"srO_DESC": "", "srO_ID": 4}]
		fake = self._fake(can_write=False)
		fake.db.exists.side_effect = lambda doctype, name=None: False
		result = self._schedules(fake, rows)
		self.assertEqual(result["schedules"], [{"sro_id": 3, "sro_desc": "EIGHTH SCHEDULE Table 1"}])
		self.assertIn("cannot add them", result["note"])
		fake.get_doc.assert_not_called()
		fake.db.commit.assert_not_called()
		fake = self._fake(can_write=True)
		fake.db.exists.side_effect = lambda doctype, name=None: False
		result = self._schedules(fake, rows)
		self.assertNotIn("note", result)
		fake.get_doc.assert_called_once_with(
			{"doctype": "SRO Schedule", "sro_desc": "EIGHTH SCHEDULE Table 1", "sro_id": 3}
		)
		fake.get_doc.return_value.insert.assert_called_once_with(ignore_permissions=True)
		fake.db.commit.assert_called_once()


class TestValidateItemFields(unittest.TestCase):
	def _frappe(self, cached_uom="MMBTU"):
		fake = fake_frappe()
		fake.db.exists.side_effect = lambda doctype, name=None: {
			"HS Code": name == "2711.2100",
			"Transaction Type": name in SALE_TYPES,
			"HS Uom": name in ("KG", "MMBTU"),
		}.get(doctype, False)
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: (
			cached_uom if doctype == "HS Code" else None
		)
		return fake

	def _validate(
		self, fake, uom="KG", tax_desc="18%", rate_in_p=18, sale_type=STANDARD, settings=None, fbr=None, **kw
	):
		settings = settings if settings is not None else AISettings(allow_fbr_lookups=True)
		lookup = fbr if fbr is not None else MagicMock(return_value=["MMBTU", "KG"])
		with patch.object(tools, "frappe", fake), patch.object(tools, "_fbr_uoms", lookup):
			result = tools._validate_item_fields(
				"Acme", "2711.2100", uom, tax_desc, rate_in_p, sale_type, settings, **kw
			)
		return result, lookup

	def test_a_unit_fbr_lists_is_accepted_even_when_the_cache_holds_another(self):
		# 2711.2100 is posted with MMBTU (SN014) and KG (SN023); the cache holds one of them.
		result, lookup = self._validate(self._frappe("MMBTU"), uom="kg")
		self.assertEqual(result, ("2711.2100", "KG", "18%", 18.0, STANDARD, []))
		self.assertEqual(lookup.call_args.args[:2], ("2711.2100", "Acme"))

	def test_a_unit_fbr_does_not_list_is_refused(self):
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("MMBTU"), uom="KG", fbr=MagicMock(return_value=["MMBTU"]))
		self.assertIn("FBR allows MMBTU", str(ctx.exception))

	def test_cache_mismatch_becomes_a_warning_when_fbr_cannot_be_asked(self):
		result, _lookup = self._validate(
			self._frappe("MMBTU"), uom="KG", fbr=MagicMock(side_effect=tools.ToolError("FBR lookup failed"))
		)
		self.assertEqual(result[1], "KG")
		self.assertEqual(len(result[5]), 1)
		self.assertIn("0099", result[5][0])
		result, lookup = self._validate(
			self._frappe("MMBTU"), uom="KG", settings=AISettings(allow_fbr_lookups=False)
		)
		lookup.assert_not_called()
		self.assertIn("0099", result[5][0])
		result, lookup = self._validate(self._frappe("MMBTU"), uom="KG", cached_uom_required=False)
		lookup.assert_not_called()
		self.assertIn("0099", result[5][0])

	def test_matching_cache_needs_no_lookup(self):
		result, lookup = self._validate(self._frappe("KG"), uom="KG")
		lookup.assert_not_called()
		self.assertEqual(result[5], [])

	def test_blank_cache_asks_fbr(self):
		with self.assertRaises(tools.ToolError):
			self._validate(self._frappe(""), uom="KG", fbr=MagicMock(return_value=["MMBTU"]))
		result, lookup = self._validate(self._frappe(""), uom="KG", fbr=MagicMock(return_value=["KG"]))
		lookup.assert_called_once()
		self.assertEqual(result[5], [])

	def test_unknown_unit_and_unknown_hs_code(self):
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe(), uom="cartons")
		self.assertIn("not an FBR unit", str(ctx.exception))
		fake = self._frappe()
		fake.db.exists.side_effect = lambda doctype, name=None: False
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(fake)
		self.assertIn("not in the master", str(ctx.exception))

	def test_literal_rate_text_keeps_its_wording_and_needs_a_sale_type(self):
		literal = "18% along with rupees 60 per kilogram"
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("KG"), tax_desc=literal, rate_in_p=18, sale_type=None)
		self.assertIn("literal", str(ctx.exception))
		result, _lookup = self._validate(
			self._frappe("KG"), tax_desc=literal, rate_in_p=18, sale_type="Potassium Chlorate"
		)
		self.assertEqual(result[2:5], (literal, 18.0, "Potassium Chlorate"))
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("KG"), tax_desc=literal, rate_in_p=60, sale_type="Potassium Chlorate")
		self.assertIn("does not match", str(ctx.exception))
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("KG"), tax_desc=literal, rate_in_p=18, sale_type=STANDARD)
		self.assertIn("plain 18%", str(ctx.exception))

	def test_plain_rates_and_mismatches(self):
		result, _lookup = self._validate(self._frappe("KG"), tax_desc="18", rate_in_p=None, sale_type=None)
		self.assertEqual(result[2:5], ("18%", 18.0, STANDARD))
		self.assertIn("inferred from the 18% rate", result[5][0])
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("KG"), tax_desc="18%", rate_in_p=17)
		self.assertIn("does not match", str(ctx.exception))
		with self.assertRaises(tools.ToolError):
			self._validate(self._frappe("KG"), tax_desc="5%", rate_in_p=5, sale_type=STANDARD)
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(self._frappe("KG"), tax_desc="5%", rate_in_p=5, sale_type=None)
		self.assertIn("sale_type is required", str(ctx.exception))

	def test_exempt_and_flat_rupee_rates(self):
		result, _lookup = self._validate(self._frappe("KG"), tax_desc="Exempt", rate_in_p=0, sale_type=None)
		self.assertEqual(result[2:5], ("Exempt", 0.0, rules.EXEMPT_SALE_TYPE))
		self.assertIn("Exempt", result[5][0])
		with self.assertRaises(tools.ToolError):
			self._validate(self._frappe("KG"), tax_desc="Exempt", rate_in_p=5, sale_type=None)
		with self.assertRaises(tools.ToolError) as ctx:
			self._validate(
				self._frappe("KG"), tax_desc="Rs.2", rate_in_p=2, sale_type="Cement /Concrete Block"
			)
		self.assertIn("by hand", str(ctx.exception))

	def test_blank_cache_without_an_fbr_answer_is_flagged(self):
		result, _lookup = self._validate(self._frappe(""), uom="KG", fbr=MagicMock(return_value=[]))
		self.assertEqual(len(result[5]), 1)
		self.assertIn("could not be confirmed", result[5][0])
		self.assertIn("0099", result[5][0])

	def test_a_stored_flat_rupee_rate_is_kept_when_only_the_unit_changes(self):
		result, _lookup = self._validate(
			self._frappe("KG"),
			tax_desc="Rs.2",
			rate_in_p=2,
			sale_type="Cement /Concrete Block",
			stored_tax_desc="Rs.2",
		)
		self.assertEqual(result[2:4], ("Rs.2", 2.0))
		with self.assertRaises(tools.ToolError):
			self._validate(
				self._frappe("KG"),
				tax_desc="Rs.5",
				rate_in_p=5,
				sale_type="Cement /Concrete Block",
				stored_tax_desc="Rs.2",
			)

	def test_sale_type_takes_the_stored_spelling(self):
		fake = self._frappe("KG")
		fake.db.exists.side_effect = lambda doctype, name=None: {
			"HS Code": name == "2711.2100",
			"Transaction Type": "Goods at Reduced Rate"
			if str(name).lower() == "goods at reduced rate"
			else False,
			"HS Uom": name in ("KG", "MMBTU"),
		}.get(doctype, False)
		result, _lookup = self._validate(fake, tax_desc="5%", rate_in_p=5, sale_type="goods at reduced rate")
		self.assertEqual(result[4], "Goods at Reduced Rate")


class TestUpdateTaxItem(unittest.TestCase):
	def _doc(self):
		doc = SimpleNamespace(
			name="Water filter",
			seller="Acme",
			hs_code="8421.2100",
			product_uom="KG",
			tax_desc="18%",
			rate_in_p=18,
			transaction_type=STANDARD,
			rate_id=77,
			fixed_rs=0,
		)
		doc.save = MagicMock()
		doc.as_dict = lambda: {
			"name": doc.name,
			"seller": doc.seller,
			"hs_code": doc.hs_code,
			"product_uom": doc.product_uom,
			"tax_desc": doc.tax_desc,
			"rate_in_p": doc.rate_in_p,
			"transaction_type": doc.transaction_type,
			"fixed_rs": doc.fixed_rs,
			"rate_id": doc.rate_id,
		}
		return doc

	def _run(self, doc, validated, **kwargs):
		fake = fake_frappe()
		fake.db.exists.return_value = True
		fake.get_doc.return_value = doc
		fake.get_list.return_value = []
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "require_seller", lambda s: s),
			patch.object(tools, "_validate_item_fields", return_value=validated),
		):
			return tools.update_tax_item("Water filter", **kwargs), fake

	def test_rate_change_clears_a_stale_rate_id(self):
		doc = self._doc()
		result, fake = self._run(
			doc,
			("8421.2100", "KG", "5%", 5.0, "Goods at Reduced Rate", []),
			tax_desc="5%",
			rate_in_p=5,
			sale_type="Goods at Reduced Rate",
		)
		self.assertEqual(doc.rate_id, 0)
		self.assertTrue(any("rate_id was cleared" in a for a in result["assumptions"]))
		self.assertEqual(result["tax_item"]["rate_id"], None)
		doc.save.assert_called_once()
		fake.db.commit.assert_called_once()

	def test_unchanged_rate_keeps_it_and_a_given_rate_id_wins(self):
		doc = self._doc()
		result, _fake = self._run(
			doc, ("8421.2100", "Numbers, pieces, units", "18%", 18.0, STANDARD, []), uom="pcs"
		)
		self.assertEqual(doc.rate_id, 77)
		self.assertEqual(doc.product_uom, "Numbers, pieces, units")
		self.assertEqual(result["assumptions"], [])
		doc = self._doc()
		self._run(doc, ("8421.2100", "KG", "5%", 5.0, "Goods at Reduced Rate", []), tax_desc="5%", rate_id=91)
		self.assertEqual(doc.rate_id, 91)

	def test_unknown_item_and_shared_items(self):
		fake = fake_frappe()
		fake.db.exists.return_value = False
		with patch.object(tools, "frappe", fake), self.assertRaises(tools.ToolError):
			tools.update_tax_item("Nope")
		doc = self._doc()
		doc.seller = ""
		fake = fake_frappe()
		fake.db.exists.return_value = True
		fake.get_doc.return_value = doc
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "current_user_role", return_value="DI Panel User"),
			self.assertRaises(tools.ToolError) as ctx,
		):
			tools.update_tax_item("Water filter", uom="KG")
		self.assertIn("administrator", str(ctx.exception))

	def test_rate_text_without_a_percent_sign_is_not_a_change(self):
		doc = self._doc()
		doc.tax_desc = "18"
		result, _fake = self._run(doc, ("8421.2100", "KG", "18%", 18.0, STANDARD, []), uom="KG")
		self.assertEqual(doc.rate_id, 77)
		self.assertEqual(result["assumptions"], [])

	def test_a_new_rate_text_takes_its_number_from_the_text(self):
		fake = fake_frappe()
		fake.db.exists.return_value = True
		fake.get_list.return_value = []
		validate = MagicMock(return_value=("8421.2100", "KG", "Exempt", 0.0, "Exempt goods", []))
		patches = (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "require_seller", lambda s: s),
			patch.object(tools, "_validate_item_fields", validate),
		)
		fake.get_doc.return_value = self._doc()
		with patches[0], patches[1], patches[2]:
			tools.update_tax_item("Water filter", tax_desc="Exempt")
		args, kwargs = validate.call_args
		self.assertEqual((args[3], args[4]), ("Exempt", None))
		self.assertEqual(kwargs["stored_tax_desc"], "18%")
		fake.get_doc.return_value = self._doc()
		with patches[0], patches[1], patches[2]:
			tools.update_tax_item("Water filter", uom="KG")
		args, _kwargs = validate.call_args
		self.assertEqual((args[3], args[4]), ("18%", 18))

	def test_write_permission_is_checked_on_the_item(self):
		doc = self._doc()
		fake = fake_frappe()
		fake.db.exists.return_value = True
		fake.get_doc.return_value = doc
		fake.has_permission.return_value = False
		with patch.object(tools, "frappe", fake), self.assertRaises(tools.ToolError):
			tools.update_tax_item("Water filter", uom="KG")
		doc.save.assert_not_called()


class TestCreateBuyer(unittest.TestCase):
	def _frappe(self, seller_ntn="1234567", existing=(), taken=()):
		fake = fake_frappe()
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: (
			seller_ntn if doctype == "Seller Or Company" else None
		)
		fake.get_list.return_value = list(existing)
		fake.db.exists.side_effect = lambda doctype, name=None: doctype == "Buyer" and name in taken
		doc = MagicMock()
		doc.as_dict.return_value = {
			"name": "New Buyer (Acme)",
			"buyer_registration_type": "Registered",
			"buyer_ntncnic": "4739616",
			"buyer_province": "PUNJAB",
			"buyer_address": "12 Main Road",
			"seller": "Acme",
		}
		fake.get_doc.return_value = doc
		return fake, doc

	def _create(self, fake, **overrides):
		args = dict(
			seller="Acme",
			name="New Buyer",
			registration_type="registered",
			ntn_cnic="4739616",
			province="punjab",
			address="12 Main Road, Lahore",
		)
		args.update(overrides)
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "allowed_sellers", return_value=["Acme"]),
		):
			return tools.create_buyer(**args)

	def test_sellers_own_ntn_is_refused_before_any_write(self):
		fake, _doc = self._frappe(seller_ntn="4739616-1")
		with self.assertRaises(tools.ToolError) as ctx:
			self._create(fake)
		self.assertIn("0058", str(ctx.exception))
		fake.get_doc.assert_not_called()

	def test_existing_buyer_is_returned_not_duplicated(self):
		row = {
			"name": "Old Name",
			"buyer_registration_type": "Registered",
			"buyer_ntncnic": "4739616",
			"buyer_province": "PUNJAB",
			"buyer_address": "x",
			"seller": "Acme",
		}
		fake, doc = self._frappe(existing=[row])
		result = self._create(fake)
		self.assertFalse(result["created"])
		self.assertEqual(result["buyer"]["name"], "Old Name")
		self.assertEqual(result["buyer"]["ntn_cnic"], "***9616")
		doc.insert.assert_not_called()
		fake.db.commit.assert_not_called()
		# Same name with another number is also a match.
		fake, _doc = self._frappe(existing=[dict(row, name="new buyer", buyer_ntncnic="7654321")])
		self.assertFalse(self._create(fake)["created"])

	def test_new_buyer_is_inserted_committed_and_renamed_when_taken(self):
		fake, doc = self._frappe(taken={"New Buyer"})
		result = self._create(fake)
		self.assertEqual(
			fake.get_doc.call_args.args[0],
			{
				"doctype": "Buyer",
				"seller": "Acme",
				"buyer_businessname": "New Buyer (Acme)",
				"buyer_registration_type": "Registered",
				"buyer_ntncnic": "4739616",
				"buyer_province": "PUNJAB",
				"buyer_address": "12 Main Road, Lahore",
			},
		)
		doc.insert.assert_called_once()
		fake.db.commit.assert_called_once()
		self.assertTrue(result["created"])
		self.assertIn("New Buyer (Acme)", result["note"])

	def test_write_permission_is_checked_on_the_unsaved_doc(self):
		fake, doc = self._frappe()
		fake.has_permission.side_effect = lambda doctype, ptype, doc=None: doctype != "Buyer"
		with self.assertRaises(tools.ToolError):
			self._create(fake)
		doc.insert.assert_not_called()

	def test_bad_inputs_are_sentences(self):
		fake, _doc = self._frappe()
		cases = (
			({"name": "A"}, "name is required"),
			({"name": "<b>x</b>"}, "cannot contain"),
			({"registration_type": "Walk-in"}, "registration_type"),
			({"ntn_cnic": "0000000"}, "placeholder"),
			({"ntn_cnic": "90200283"}, "check digit"),
			({"province": "Lahore"}, "province must be"),
			({"address": "x"}, "address is required"),
		)
		for overrides, fragment in cases:
			with self.assertRaises(tools.ToolError, msg=overrides) as ctx:
				self._create(fake, **overrides)
			self.assertIn(fragment, str(ctx.exception))

	def test_write_cap(self):
		settings = AISettings(counters={"writes": tools.WRITE_CALLS_PER_TURN})
		with patch.object(tools, "require_seller") as require, self.assertRaises(tools.ToolError) as ctx:
			tools.create_buyer("Acme", "N", "Registered", "4739616", "PUNJAB", "addr", settings=settings)
		self.assertIn("Too many master records created", str(ctx.exception))
		require.assert_not_called()


MASTERS = {
	"Water filter": {
		"name": "Water filter",
		"seller": "Acme",
		"hs_code": "8421.2100",
		"product_uom": "Numbers, pieces, units",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"transaction_type": STANDARD,
		"fixed_rs": 0,
		"rate_id": 1,
	},
	"Cement": {
		"name": "Cement",
		"seller": "Acme",
		"hs_code": "2523.2900",
		"product_uom": "KG",
		"tax_desc": "Rs.2",
		"rate_in_p": 2,
		"transaction_type": "Cement /Concrete Block",
		"fixed_rs": 0,
		"rate_id": 2,
	},
	"Mystery": {
		"name": "Mystery",
		"seller": "",
		"hs_code": "4820.9000",
		"product_uom": "KG",
		"tax_desc": "5%",
		"rate_in_p": 5,
		"transaction_type": "",
		"fixed_rs": 0,
		"rate_id": None,
	},
	"Phone": {
		"name": "Phone",
		"seller": "Acme",
		"hs_code": "8517.1310",
		"product_uom": "Numbers, pieces, units",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"transaction_type": "3rd Schedule Goods",
		"fixed_rs": 0,
		"rate_id": 3,
	},
	"Other Co item": {
		"name": "Other Co item",
		"seller": "Beta",
		"hs_code": "4820.9000",
		"product_uom": "KG",
		"tax_desc": "18%",
		"rate_in_p": 18,
		"transaction_type": STANDARD,
		"fixed_rs": 0,
		"rate_id": 4,
	},
	"Potassium chlorate": {
		"name": "Potassium chlorate",
		"seller": "Acme",
		"hs_code": "2829.1900",
		"product_uom": "KG",
		"tax_desc": "18% along with rupees 60 per kilogram",
		"rate_in_p": 18,
		"transaction_type": "",
		"fixed_rs": 0,
		"rate_id": 5,
	},
}


class TestPrepareItems(unittest.TestCase):
	def _frappe(self):
		fake = fake_frappe()

		def get_value(doctype, name, fields=None, as_dict=False, **kw):
			if doctype == "Tax Item":
				# Frappe matches names without regard to case; so does this fake.
				master = next((m for key, m in MASTERS.items() if key.lower() == str(name).lower()), None)
				return SimpleNamespace(**master) if master else None
			if doctype == "Sale Type":
				return canonical_sale_type(name)
			return None

		fake.db.get_value.side_effect = get_value
		fake.db.exists.side_effect = lambda doctype, name=None: (
			doctype == "SRO Schedule" and name == "EIGHTH SCHEDULE Table 1"
		)
		return fake

	def test_happy_path(self):
		with patch.object(tools, "frappe", self._frappe()):
			rows, sale_type, assumptions = tools._prepare_items(
				"Acme", [{"tax_item": "Water filter", "quantity": 3, "sale_rate": 4500}]
			)
		self.assertEqual(sale_type, STANDARD)
		self.assertEqual(rows[0]["quantity"], 3.0)
		self.assertEqual(rows[0]["sale_rate"], 4500.0)
		self.assertEqual(rows[0]["description"], "Water filter")
		self.assertEqual(assumptions, [])

	def test_sale_type_is_stored_in_the_masters_spelling(self):
		with patch.object(tools, "frappe", self._frappe()):
			rows, sale_type, _assumptions = tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Water filter",
						"quantity": 1,
						"sale_rate": 10,
						"sale_type": "goods at standard rate (default)",
					}
				],
			)
		self.assertEqual((rows[0]["sale_type"], sale_type), (STANDARD, STANDARD))
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Water filter",
						"quantity": 1,
						"sale_rate": 10,
						"sale_type": "Goods at Fancy Rate",
					}
				],
			)
		self.assertIn("not a Sale Type", str(ctx.exception))

	def test_zero_price_is_refused(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items("Acme", [{"tax_item": "Water filter", "quantity": 1, "sale_rate": 0}])
		self.assertIn("sale_rate", str(ctx.exception))

	def test_flat_rupee_rates_are_refused(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items("Acme", [{"tax_item": "Cement", "quantity": 1000, "sale_rate": 25}])
		self.assertIn("by hand", str(ctx.exception))

	def test_blank_sale_type_with_an_odd_rate_asks(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items("Acme", [{"tax_item": "Mystery", "quantity": 1, "sale_rate": 10}])
		self.assertIn("sale_type", str(ctx.exception))

	def test_literal_rate_item_needs_its_own_sale_type(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items("Acme", [{"tax_item": "Potassium chlorate", "quantity": 1, "sale_rate": 10}])
		self.assertIn("literal", str(ctx.exception))
		with patch.object(tools, "frappe", self._frappe()):
			_rows, sale_type, _a = tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Potassium chlorate",
						"quantity": 1,
						"sale_rate": 10,
						"sale_type": "Potassium Chlorate",
					}
				],
			)
		self.assertEqual(sale_type, "Potassium Chlorate")
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items(
				"Acme",
				[{"tax_item": "Potassium chlorate", "quantity": 1, "sale_rate": 10, "sale_type": STANDARD}],
			)
		self.assertIn("plain 18%", str(ctx.exception))

	def test_third_schedule_needs_a_retail_price(self):
		with patch.object(tools, "frappe", self._frappe()):
			with self.assertRaises(tools.ToolError) as ctx:
				tools._prepare_items("Acme", [{"tax_item": "Phone", "quantity": 1, "sale_rate": 50000}])
			self.assertIn("0090", str(ctx.exception))
			rows, _sale_type, _assumptions = tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Phone",
						"quantity": 1,
						"sale_rate": 50000,
						"fixed_notified_value_or_retail_price": 52000,
					}
				],
			)
		self.assertEqual(rows[0]["fixed_notified_value_or_retail_price"], 52000.0)

	def test_another_sellers_item_is_not_available(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items("Acme", [{"tax_item": "Other Co item", "quantity": 1, "sale_rate": 10}])
		self.assertNotIn("Beta", str(ctx.exception))

	def test_mixed_sale_types_are_refused(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items(
				"Acme",
				[
					{"tax_item": "Water filter", "quantity": 1, "sale_rate": 10},
					{
						"tax_item": "Phone",
						"quantity": 1,
						"sale_rate": 10,
						"fixed_notified_value_or_retail_price": 10,
					},
				],
			)
		self.assertIn("one draft per sale type", str(ctx.exception))

	def test_unknown_sro_schedule_is_refused(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Water filter",
						"quantity": 1,
						"sale_rate": 10,
						"sro_schedule_no": "NINTH SCHEDULE",
					}
				],
			)
		self.assertIn("lookup_sro_schedules", str(ctx.exception))
		with patch.object(tools, "frappe", self._frappe()):
			rows, _s, _a = tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Water filter",
						"quantity": 1,
						"sale_rate": 10,
						"sro_schedule_no": "EIGHTH SCHEDULE Table 1",
						"sro_item_serial_no": "70",
					}
				],
			)
		self.assertEqual(
			(rows[0]["sro_schedule_no"], rows[0]["sro_item_serial_no"]), ("EIGHTH SCHEDULE Table 1", "70")
		)

	def test_rows_carry_the_masters_spelling_and_fixed_retail_price(self):
		shampoo = {
			"name": "Shampoo",
			"seller": "Acme",
			"hs_code": "3305.1000",
			"product_uom": "Numbers, pieces, units",
			"tax_desc": "18%",
			"rate_in_p": 18,
			"transaction_type": "3rd Schedule Goods",
			"fixed_rs": 350,
			"rate_id": 6,
		}
		with patch.dict(MASTERS, {"Shampoo": shampoo}), patch.object(tools, "frappe", self._frappe()):
			rows, _s, _a = tools._prepare_items(
				"Acme", [{"tax_item": "water filter", "quantity": 1, "sale_rate": 10}]
			)
			self.assertEqual(rows[0]["description"], "Water filter")
			rows, _s, assumptions = tools._prepare_items(
				"Acme",
				[
					{
						"tax_item": "Shampoo",
						"quantity": 2,
						"sale_rate": 300,
						"fixed_notified_value_or_retail_price": 300,
					}
				],
			)
			# What the controller stores (Tax Item.fixed_rs wins), so the twin check compares like with like.
			self.assertEqual(rows[0]["fixed_notified_value_or_retail_price"], 350.0)
			self.assertTrue(any("overrides" in a for a in assumptions))
			rows, _s, _a = tools._prepare_items(
				"Acme", [{"tax_item": "Shampoo", "quantity": 2, "sale_rate": 300}]
			)
			self.assertEqual(rows[0]["fixed_notified_value_or_retail_price"], 350.0)


class TestResolveScenario(unittest.TestCase):
	def _frappe(self):
		fake = fake_frappe()
		scenarios = {"SN001": STANDARD, "SN002": STANDARD, "SN006": "Exempt goods"}
		fake.db.exists.side_effect = lambda doctype, name=None: doctype == "Scenario" and name in scenarios
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: (
			scenarios.get(name) if doctype == "Scenario" else None
		)
		return fake

	def test_derived_scenario_matches_sale_type_and_buyer(self):
		with patch.object(tools, "frappe", self._frappe()):
			self.assertEqual(tools._resolve_scenario(None, STANDARD, "Unregistered"), "SN002")
			self.assertEqual(tools._resolve_scenario("", "Exempt goods", "Registered"), "SN006")

	def test_explicit_scenario_is_checked_against_the_buyer_the_sale_type_and_the_master(self):
		with patch.object(tools, "frappe", self._frappe()):
			with self.assertRaises(tools.ToolError) as ctx:
				tools._resolve_scenario("SN001", STANDARD, "Unregistered")
			self.assertIn("expects a registered buyer", str(ctx.exception))
			with self.assertRaises(tools.ToolError) as ctx:
				tools._resolve_scenario("SN006", STANDARD, "Registered")
			self.assertIn("is for sale type", str(ctx.exception))
			with self.assertRaises(tools.ToolError) as ctx:
				tools._resolve_scenario("SN099", STANDARD, "Registered")
			self.assertIn("does not exist", str(ctx.exception))

	def test_no_scenario_for_the_combination(self):
		with patch.object(tools, "frappe", self._frappe()), self.assertRaises(tools.ToolError) as ctx:
			tools._resolve_scenario(None, "Cotton ginners", "Unregistered")
		self.assertIn("0100", str(ctx.exception))

	def test_scenario_ids_and_sale_type_spelling_are_matched_without_regard_to_case(self):
		fake = self._frappe()
		scenarios = {"SN001": "Goods at Standard Rate (default)"}
		fake.db.exists.side_effect = lambda doctype, name=None: doctype == "Scenario" and name in scenarios
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: (
			scenarios.get(name) if doctype == "Scenario" else None
		)
		with patch.object(tools, "frappe", fake):
			self.assertEqual(tools._resolve_scenario("sn001", STANDARD, "Registered"), "SN001")


def buyer(**overrides):
	row = {
		"name": "UoE",
		"seller": "Acme",
		"buyer_registration_type": "Registered",
		"buyer_ntncnic": "9020028",
	}
	row.update(overrides)
	return row


class TestCheckBuyer(unittest.TestCase):
	def _frappe(self, row, seller_ntn="1234567"):
		fake = fake_frappe()
		fake.db.get_value.side_effect = lambda doctype, name, fields=None, as_dict=False, **kw: (
			(SimpleNamespace(**row) if row else None) if doctype == "Buyer" else seller_ntn
		)
		return fake

	def test_own_buyer_is_returned(self):
		fake = self._frappe(buyer())
		with patch.object(tools, "frappe", fake):
			row = tools._check_buyer("Acme", " UoE ")
		self.assertEqual((row.name, row.buyer_registration_type), ("UoE", "Registered"))
		fake.has_permission.assert_called_once_with("Buyer", "read", doc="UoE")

	def test_other_sellers_buyer_is_refused_without_naming_the_other_seller(self):
		fake = self._frappe(buyer(seller="Beta"))
		with patch.object(tools, "frappe", fake), self.assertRaises(tools.ToolError) as ctx:
			tools._check_buyer("Acme", "UoE")
		self.assertNotIn("Beta", str(ctx.exception))
		self.assertIn("search_buyers", str(ctx.exception))
		fake.has_permission.assert_not_called()

	def test_unknown_and_blank_buyers(self):
		fake = self._frappe(None)
		with patch.object(tools, "frappe", fake):
			for name in ("Nobody", "", None):
				with self.assertRaises(tools.ToolError):
					tools._check_buyer("Acme", name)
		fake.db.get_value.assert_called_once()

	def test_shared_buyer_is_allowed(self):
		fake = self._frappe(
			buyer(
				name="Walk-in",
				seller=None,
				buyer_registration_type="Unregistered",
				buyer_ntncnic="4210112345678",
			)
		)
		with patch.object(tools, "frappe", fake):
			self.assertEqual(tools._check_buyer("Acme", "Walk-in").name, "Walk-in")
		fake.has_permission.assert_called_once_with("Buyer", "read", doc="Walk-in")

	def test_unreadable_buyer_is_refused(self):
		fake = self._frappe(buyer())
		fake.has_permission.return_value = False
		with patch.object(tools, "frappe", fake), self.assertRaises(tools.ToolError):
			tools._check_buyer("Acme", "UoE")

	def test_self_invoicing_is_refused(self):
		fake = self._frappe(buyer(buyer_ntncnic="1234567"), seller_ntn="1234567-8")
		with patch.object(tools, "frappe", fake), self.assertRaises(tools.ToolError) as ctx:
			tools._check_buyer("Acme", "UoE")
		self.assertIn("0058", str(ctx.exception))


ROWS = [
	{
		"description": "Water filter",
		"quantity": 3.0,
		"sale_rate": 4500.0,
		"discount": 0.0,
		"sale_type": STANDARD,
		"sro_schedule_no": "",
		"sro_item_serial_no": "",
		"fixed_notified_value_or_retail_price": 0.0,
	},
	{
		"description": "Cement",
		"quantity": 1.0,
		"sale_rate": 10.0,
		"discount": 0.0,
		"sale_type": STANDARD,
		"sro_schedule_no": "",
		"sro_item_serial_no": "",
		"fixed_notified_value_or_retail_price": 0.0,
	},
]


def line(**fields):
	row = {
		"description": "",
		"quantity": 0,
		"sale_rate": 0,
		"discount": 0,
		"sro_schedule_no": "",
		"sro_item_serial_no": "",
		"fixed_notified_value_or_retail_price": 0,
	}
	row.update(fields)
	return frappe._dict(row)


class TestRecentIdenticalDraft(unittest.TestCase):
	def _run(self, fake):
		with patch.object(tools, "frappe", fake), patch.object(tools, "now_datetime", lambda: FIXED_NOW):
			return tools._recent_identical_draft("Acme", "UoE", "2026-10-09", ROWS, "Production", "SN001")

	def test_same_lines_in_any_order_within_the_window_are_a_twin(self):
		fake = fake_frappe()
		fake.get_list.return_value = ["STI-0399"]
		fake.get_all.return_value = [
			line(description="Cement", quantity=1, sale_rate=10),
			line(description="Water filter", quantity="3", sale_rate=4500),
		]
		self.assertEqual(self._run(fake), "STI-0399")
		call = fake.get_list.call_args
		self.assertEqual(call.args, ("Sale Tax Invoice",))
		self.assertEqual(call.kwargs["pluck"], "name")
		filters = call.kwargs["filters"]
		for expected in (
			["Sale Tax Invoice", "docstatus", "=", 0],
			["Sale Tax Invoice", "owner", "=", "clerk@example.com"],
			["Sale Tax Invoice", "seller__business_name", "=", "Acme"],
			["Sale Tax Invoice", "buyer", "=", "UoE"],
			["Sale Tax Invoice", "invoice_date", "=", "2026-10-09"],
			["Sale Tax Invoice", "fbr_environment", "=", "Production"],
			["Sale Tax Invoice", "scenario_id", "=", "SN001"],
			["Sale Tax Invoice", "creation", ">=", FIXED_NOW - datetime.timedelta(minutes=10)],
		):
			self.assertIn(expected, filters)
		self.assertEqual(fake.get_all.call_args.kwargs["fields"], list(tools._LINE_FIELDS))
		self.assertEqual(
			fake.get_all.call_args.kwargs["filters"], {"parent": "STI-0399", "parenttype": "Sale Tax Invoice"}
		)

	def test_any_money_or_sro_difference_is_not_a_twin(self):
		fake = fake_frappe()
		fake.get_list.return_value = ["STI-0397", "STI-0398", "STI-0399"]
		fake.get_all.side_effect = [
			[line(description="Water filter", quantity=3, sale_rate=4500)],
			[
				line(description="Water filter", quantity=3, sale_rate=4500, discount=100),
				line(description="Cement", quantity=1, sale_rate=10),
			],
			[
				line(
					description="Water filter",
					quantity=3,
					sale_rate=4500,
					sro_schedule_no="EIGHTH SCHEDULE Table 1",
				),
				line(description="Cement", quantity=1, sale_rate=10),
			],
		]
		self.assertIsNone(self._run(fake))
		self.assertEqual(fake.get_all.call_count, 3)

	def test_no_recent_drafts(self):
		fake = fake_frappe()
		fake.get_list.return_value = []
		self.assertIsNone(self._run(fake))
		fake.get_all.assert_not_called()


class FakeInvoice(SimpleNamespace):
	def __init__(self, **kwargs):
		super().__init__(**kwargs)
		self.insert = MagicMock()
		self.saves = 0

	def get(self, key, default=None):
		return getattr(self, key, default)

	def set(self, key, value):
		setattr(self, key, value)

	def append(self, key, row):
		getattr(self, key).append(row)

	def save(self):
		self.saves += 1


DRAFT_ITEMS = [{"tax_item": "Water filter", "quantity": 3, "sale_rate": 4500}]


class TestCreateDraftInvoice(unittest.TestCase):
	def _run(self, fake, twin=None, **kwargs):
		buyer_row = SimpleNamespace(**buyer())
		seen = {}
		patches = [
			patch.object(tools, "frappe", fake),
			patch.object(tools, "require_seller", lambda seller: seller),
			patch.object(
				tools,
				"_check_buyer",
				lambda seller, name: seen.setdefault("buyer", (seller, name)) and buyer_row,
			),
			patch.object(tools, "_environment_for_user", lambda requested, settings: "Production"),
			patch.object(tools, "_prepare_items", lambda seller, items: (ROWS, STANDARD, ["assumed"])),
			patch.object(
				tools,
				"_resolve_scenario",
				lambda scenario_id, sale_type, kind: (
					seen.setdefault("scenario", (scenario_id, sale_type, kind)) and "SN001"
				),
			),
			patch.object(tools, "_parse_date", lambda value: "2026-10-09"),
			patch.object(
				tools, "_recent_identical_draft", lambda *args: seen.setdefault("twin_args", args) and twin
			),
			patch.object(tools, "invoice_summary", lambda doc: {"name": doc.name}),
			patch.object(tools, "invoice_warnings", lambda doc: ["w"]),
		]
		with ExitStack() as stack:
			for p in patches:
				stack.enter_context(p)
			result = tools.create_draft_invoice("Acme", "UoE", DRAFT_ITEMS, **kwargs)
		return result, seen

	def test_twin_is_returned_instead_of_a_duplicate(self):
		fake = fake_frappe()
		existing = FakeInvoice(name="STI-0399")
		fake.get_doc.return_value = existing
		result, seen = self._run(fake, twin="STI-0399")
		self.assertEqual(result["created"], False)
		self.assertIn("STI-0399", result["note"])
		self.assertEqual(result["invoice"], {"name": "STI-0399"})
		self.assertEqual(seen["twin_args"], ("Acme", "UoE", "2026-10-09", ROWS, "Production", "SN001"))
		fake.get_doc.assert_called_once_with("Sale Tax Invoice", "STI-0399")
		existing.insert.assert_not_called()
		fake.db.commit.assert_not_called()

	def test_new_draft_shape_insert_and_commit(self):
		fake = fake_frappe()
		doc = FakeInvoice(name="STI-0400")
		fake.get_doc.return_value = doc
		result, seen = self._run(
			fake, environment="production", invoice_date="2026-10-09", scenario_id="sn001"
		)
		self.assertEqual(
			fake.get_doc.call_args.args[0],
			{
				"doctype": "Sale Tax Invoice",
				"invoice_type": "Sale Invoice",
				"invoice_date": "2026-10-09",
				"scenario_id": "SN001",
				"fbr_environment": "Production",
				"buyer": "UoE",
				"seller__business_name": "Acme",
				"invoice_items": ROWS,
			},
		)
		self.assertEqual(seen["scenario"], ("sn001", STANDARD, "Registered"))
		fake.has_permission.assert_called_once_with("Sale Tax Invoice", "write", doc=doc)
		doc.insert.assert_called_once_with()
		fake.db.commit.assert_called_once_with()
		self.assertEqual(result["created"], True)
		self.assertEqual(result["assumptions"], ["assumed"])
		self.assertEqual(result["warnings"], ["w"])
		self.assertEqual(result["invoice"], {"name": "STI-0400"})

	def test_write_permission_refusal_before_insert(self):
		fake = fake_frappe()
		fake.has_permission.return_value = False
		doc = FakeInvoice(name="new")
		fake.get_doc.return_value = doc
		with self.assertRaises(tools.ToolError) as ctx:
			self._run(fake)
		self.assertIn("cannot create invoices", str(ctx.exception))
		doc.insert.assert_not_called()
		fake.db.commit.assert_not_called()

	def test_write_budget_is_counted(self):
		settings = AISettings(counters={"writes": tools.WRITE_CALLS_PER_TURN})
		fake = fake_frappe()
		with self.assertRaises(tools.ToolError) as ctx:
			self._run(fake, settings=settings)
		self.assertIn("Too many drafts created", str(ctx.exception))
		fake.get_doc.assert_not_called()


def draft_doc():
	return FakeInvoice(
		name="STI-0400",
		doctype="Sale Tax Invoice",
		docstatus=0,
		seller__business_name="Acme",
		buyer="UoE",
		invoice_date="2026-10-09",
		fbr_environment="Production",
		scenario_id="SN001",
		fbr_invoice_no="",
		invoice_items=[SimpleNamespace(sale_type=STANDARD)],
	)


class TestUpdateDraftInvoice(unittest.TestCase):
	def _run(self, doc, fake=None, role="System Manager", prepare=None, **kwargs):
		fake = fake or fake_frappe()
		buyer_row = SimpleNamespace(name="UoE", buyer_registration_type="Registered")
		patches = [
			patch.object(tools, "frappe", fake),
			patch.object(tools, "_load_invoice", return_value=doc),
			patch.object(tools, "_check_buyer", return_value=buyer_row),
			patch.object(tools, "invoice_summary", lambda d: {"name": d.name}),
			patch.object(tools, "invoice_warnings", lambda d: []),
			patch.object(tools, "current_user_role", return_value=role),
		]
		if prepare is not None:
			patches.append(patch.object(tools, "_prepare_items", return_value=prepare))
		with ExitStack() as stack:
			resolve = stack.enter_context(patch.object(tools, "_resolve_scenario", return_value="SN002"))
			for p in patches:
				stack.enter_context(p)
			result = tools.update_draft_invoice("STI-0400", **kwargs)
		return result, resolve, fake

	def test_only_the_allow_listed_header_fields_change(self):
		doc = draft_doc()
		result, resolve, fake = self._run(
			doc,
			set={
				"seller__business_name": "Beta",
				"docstatus": 1,
				"fbr_invoice_no": "X",
				"invoice_date": "2026-10-01",
				"buyer": None,
			},
		)
		self.assertEqual(doc.seller__business_name, "Acme")
		self.assertEqual(doc.docstatus, 0)
		self.assertEqual(doc.fbr_invoice_no, "")
		self.assertEqual(doc.invoice_date, "2026-10-01")
		resolve.assert_not_called()
		self.assertEqual(doc.saves, 1)
		fake.db.commit.assert_called_once()
		self.assertTrue(result["ok"])

	def test_non_dict_set_is_ignored(self):
		doc = draft_doc()
		self._run(doc, set="not a dict")
		self.assertEqual(doc.invoice_date, "2026-10-09")
		self.assertEqual(doc.saves, 1)

	def test_items_replace_the_lines_and_rederive_the_scenario(self):
		doc = draft_doc()
		rows = [{"description": "Water filter", "quantity": 1.0, "sale_rate": 10.0}]
		result, resolve, _fake = self._run(
			doc, prepare=(rows, "Exempt goods", ["assumed"]), items=[{"tax_item": "Water filter"}]
		)
		self.assertEqual(doc.invoice_items, rows)
		resolve.assert_called_once_with(None, "Exempt goods", "Registered")
		self.assertEqual(doc.scenario_id, "SN002")
		self.assertEqual(result["assumptions"], ["assumed"])

	def test_buyer_change_rederives_the_scenario(self):
		doc = draft_doc()
		_result, resolve, _fake = self._run(doc, set={"buyer": "Other"})
		self.assertEqual(doc.buyer, "UoE")
		resolve.assert_called_once_with(None, STANDARD, "Registered")

	def test_submitted_and_cancelled_are_refused(self):
		for docstatus, word in ((1, "submitted"), (2, "cancelled")):
			doc = draft_doc()
			doc.docstatus = docstatus
			with self.assertRaises(tools.ToolError) as ctx:
				self._run(doc, set={"invoice_date": "2026-10-01"})
			self.assertIn(word, str(ctx.exception))
			self.assertEqual(doc.saves, 0)

	def test_panel_user_cannot_switch_to_sandbox(self):
		doc = draft_doc()
		with self.assertRaises(tools.ToolError):
			self._run(doc, role="DI Panel User", set={"fbr_environment": "Sandbox"})
		self.assertEqual(doc.saves, 0)
		self.assertEqual(doc.fbr_environment, "Production")

	def test_post_save_assertion_logs_and_refuses(self):
		doc = draft_doc()
		doc.save = lambda: setattr(doc, "fbr_invoice_no", "FBR-1")
		with self.assertRaises(tools.ToolError) as ctx:
			self._run(doc, set={"invoice_date": "2026-10-01"})
		self.assertIn("no longer a plain draft", str(ctx.exception))
		doc = draft_doc()
		doc.save = lambda: setattr(doc, "docstatus", 1)
		fake = fake_frappe()
		with self.assertRaises(tools.ToolError):
			self._run(doc, fake=fake, set={"invoice_date": "2026-10-01"})
		fake.log_error.assert_called_once()


VALID = {"validationResponse": {"statusCode": "00", "status": "Valid"}}
INVALID = {
	"validationResponse": {
		"statusCode": "01",
		"status": "Invalid",
		"errorCode": "0058",
		"invoiceStatuses": [
			{"itemSNo": "1", "status": "Invalid", "errorCode": "0099", "error": "UOM not allowed"}
		],
	}
}


def validate_doc(docstatus=0, env="Production"):
	# frappe._dict answers both doc.fbr_environment and doc.get("fbr_environment");
	# sale_tax_invoice_api._get_environment needs the latter.
	return frappe._dict(
		name="STI-0400",
		doctype="Sale Tax Invoice",
		docstatus=docstatus,
		seller__business_name="Acme",
		fbr_environment=env,
	)


class TestValidateWithFbr(unittest.TestCase):
	def _patches(self, fake, request, log, env="Production"):
		stack = ExitStack()
		stack.enter_context(patch.object(tools, "frappe", fake))
		stack.enter_context(patch.object(tools, "_load_invoice", return_value=validate_doc(env=env)))
		stack.enter_context(patch.object(tools, "seller_has_token", return_value=True))
		stack.enter_context(patch("di.integrations.di_api._make_request", request))
		stack.enter_context(
			patch(
				"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload", return_value={"p": 1}
			)
		)
		stack.enter_context(
			patch("di.integrations.sale_tax_invoice_api._get_seller_token", return_value="tok")
		)
		stack.enter_context(patch("di.digital_invoicing.doctype.di_log.di_log.create_log", log))
		return stack

	def test_switched_off(self):
		with self.assertRaises(tools.ToolError) as ctx:
			tools.validate_with_fbr("STI-0400", settings=AISettings(allow_fbr_validate=False))
		self.assertIn("switched off", str(ctx.exception))

	def test_cap_is_checked_before_loading(self):
		settings = AISettings(counters={"validates": tools.VALIDATE_CALLS_PER_TURN})
		with patch.object(tools, "_load_invoice") as load, self.assertRaises(tools.ToolError) as ctx:
			tools.validate_with_fbr("STI-0400", settings=settings)
		self.assertIn("Too many FBR validations", str(ctx.exception))
		load.assert_not_called()

	def test_submitted_is_refused(self):
		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "_load_invoice", return_value=validate_doc(docstatus=1)),
			patch.object(tools, "seller_has_token") as token,
			self.assertRaises(tools.ToolError) as ctx,
		):
			tools.validate_with_fbr("STI-0400")
		self.assertIn("validate drafts only", str(ctx.exception))
		token.assert_not_called()

	def test_missing_token_names_the_environment(self):
		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "_load_invoice", return_value=validate_doc(env="Sandbox")),
			patch.object(tools, "seller_has_token", return_value=False) as token,
			self.assertRaises(tools.ToolError) as ctx,
		):
			tools.validate_with_fbr("STI-0400")
		token.assert_called_once_with("Acme", "Sandbox")
		self.assertIn("no sandbox token", str(ctx.exception))

	def test_invalid_answer_is_logged_with_codes_and_hints(self):
		fake, request, log = fake_frappe(), MagicMock(return_value=INVALID), MagicMock()
		with self._patches(fake, request, log):
			result = tools.validate_with_fbr("STI-0400")
		self.assertFalse(result["valid"])
		self.assertEqual(result["status"], "Invalid")
		self.assertEqual(result["error_codes"], ["0058", "0099"])
		self.assertEqual(set(result["hints"]), {"0058", "0099"})
		self.assertIn("Item 1 — 0099: UOM not allowed", result["errors"])
		self.assertEqual(request.call_args.kwargs["timeout"], tools.VALIDATE_TIMEOUT)
		self.assertTrue(request.call_args.args[0].endswith("/validateinvoicedata"))
		self.assertEqual(request.call_args.args[1:3], ({"p": 1}, "tok"))
		kw = log.call_args.kwargs
		self.assertEqual((kw["status"], kw["api_type"], kw["error_code"]), ("Error", "DI Validate", "0058"))
		self.assertEqual(kw["error_message"], result["errors"])
		fake.db.commit.assert_called_once()

	def test_sandbox_draft_uses_the_sandbox_url(self):
		fake, request, log = fake_frappe(), MagicMock(return_value=VALID), MagicMock()
		with self._patches(fake, request, log, env="Sandbox"):
			result = tools.validate_with_fbr("STI-0400")
		self.assertTrue(request.call_args.args[0].endswith("/validateinvoicedata_sb"))
		self.assertEqual(result["environment"], "Sandbox")

	def test_valid_answer_is_logged_as_success(self):
		fake, request, log = fake_frappe(), MagicMock(return_value=VALID), MagicMock()
		with self._patches(fake, request, log):
			result = tools.validate_with_fbr("STI-0400")
		self.assertTrue(result["valid"])
		self.assertEqual(
			(result["status"], result["errors"], result["error_codes"], result["hints"]),
			("Valid", "", [], {}),
		)
		self.assertEqual(
			(log.call_args.kwargs["status"], log.call_args.kwargs["error_code"]), ("Success", "")
		)
		fake.db.commit.assert_called_once()

	def test_fbr_failure_is_logged_then_a_sentence(self):
		from di.integrations.http import FBRRejected

		fake, request, log = (
			fake_frappe(),
			MagicMock(side_effect=FBRRejected("401 Unauthorized")),
			MagicMock(),
		)
		with self._patches(fake, request, log), self.assertRaises(tools.ToolError) as ctx:
			tools.validate_with_fbr("STI-0400")
		self.assertIn("FBR validate failed", str(ctx.exception))
		self.assertIn("401 Unauthorized", str(ctx.exception))
		self.assertEqual(log.call_args.args[3], "401 Unauthorized")
		self.assertEqual(
			(log.call_args.kwargs["status"], log.call_args.kwargs["api_type"]), ("Error", "DI Validate")
		)
		fake.db.commit.assert_called_once()


class TestInvoiceWarnings(unittest.TestCase):
	SRO_TYPE = sorted(SRO_REQUIRED_SALE_TYPES)[0]

	def _doc(self, rows, buyer_ntn="9020028", date="2026-10-09", environment="Production"):
		return SimpleNamespace(
			seller__business_name="Acme",
			fbr_environment=environment,
			buyer_ntncnic=buyer_ntn,
			invoice_date=date,
			get=lambda key, default=None: rows if key == "invoice_items" else default,
		)

	def _row(self, **overrides):
		row = dict(
			idx=1,
			description="Water filter",
			hs_code="8421.2100",
			uom="Numbers, pieces, units",
			sale_type=STANDARD,
			tax_rate_value=18,
			rate_in_percentage="18%",
			sale_rate=4500,
			sro_schedule_no="",
			sro_item_serial_no="",
			fixed_notified_value_or_retail_price=0,
		)
		row.update(overrides)
		return SimpleNamespace(**row)

	def _warnings(self, doc, cached_uom="Numbers, pieces, units", seller_ntn="1234567", has_token=True):
		fake = fake_frappe()
		fake.db.get_value.side_effect = lambda doctype, name, field=None, **kw: {
			"Seller Or Company": seller_ntn,
			"HS Code": cached_uom,
		}.get(doctype)
		with (
			patch.object(tools, "frappe", fake),
			patch.object(tools, "seller_has_token", return_value=has_token) as token,
			patch.object(tools, "nowdate", return_value="2026-10-09"),
		):
			warnings = tools.invoice_warnings(doc)
		token.assert_called_once_with("Acme", doc.fbr_environment)
		return warnings

	def test_clean_draft_has_no_warnings(self):
		self.assertEqual(self._warnings(self._doc([self._row()])), [])

	def test_missing_token_self_invoicing_and_future_date(self):
		warnings = self._warnings(
			self._doc([self._row()], buyer_ntn="1234567-8", date="2027-01-01", environment="Sandbox"),
			has_token=False,
		)
		self.assertTrue(any("no sandbox token" in w for w in warnings))
		self.assertTrue(any("0058" in w for w in warnings))
		self.assertTrue(any("future" in w for w in warnings))

	def test_sro_rows(self):
		warnings = self._warnings(
			self._doc([self._row(sale_type=self.SRO_TYPE, tax_rate_value=5, rate_in_percentage="5%")])
		)
		self.assertTrue(any("0077/0078" in w for w in warnings))
		warnings = self._warnings(
			self._doc(
				[
					self._row(
						sale_type=self.SRO_TYPE,
						tax_rate_value=5,
						rate_in_percentage="5%",
						sro_schedule_no="EIGHTH SCHEDULE Table 1",
					)
				]
			)
		)
		self.assertTrue(any("0078" in w and "serial" in w for w in warnings))
		self.assertFalse(any("0077/0078" in w for w in warnings))
		warnings = self._warnings(
			self._doc(
				[
					self._row(
						sale_type=self.SRO_TYPE,
						tax_rate_value=5,
						rate_in_percentage="5%",
						sro_schedule_no="EIGHTH SCHEDULE Table 1",
						sro_item_serial_no="70",
					)
				]
			)
		)
		self.assertEqual(warnings, [])

	def test_retail_price_and_flat_rupee_rows(self):
		warnings = self._warnings(self._doc([self._row(sale_type="3rd Schedule Goods")]))
		self.assertTrue(any("0090" in w for w in warnings))
		warnings = self._warnings(
			self._doc([self._row(sale_type="3rd Schedule Goods", fixed_notified_value_or_retail_price=4500)])
		)
		self.assertTrue(any("retail price was taken from the sale rate" in w for w in warnings))
		warnings = self._warnings(
			self._doc([self._row(description="Cement", rate_in_percentage="Rs.2", tax_rate_value=2)])
		)
		self.assertTrue(any("0105" in w and "by hand" in w for w in warnings))

	def test_uom_against_the_cached_fbr_unit(self):
		warnings = self._warnings(self._doc([self._row(uom="KG")]), cached_uom="Numbers, pieces, units")
		self.assertTrue(any("0099" in w and "lookup_fbr_uom" in w for w in warnings))
		self.assertFalse(any("will answer 0099" in w for w in warnings))
		warnings = self._warnings(self._doc([self._row()]), cached_uom="")
		self.assertTrue(any("not confirmed yet" in w for w in warnings))


class TestSummaries(unittest.TestCase):
	def test_invoice_summary_masks_the_buyer_identity(self):
		row = SimpleNamespace(
			idx=1,
			description="Water filter",
			hs_code="8421.2100",
			uom="Numbers, pieces, units",
			quantity=3,
			sale_rate=4500,
			discount=0,
			rate_in_percentage="18%",
			tax_rate_value=18,
			sale_type=STANDARD,
			value_sales_excluding_st=13500,
			sales_tax_applicable=2430,
			total_values=15930,
			sro_schedule_no="",
			sro_item_serial_no="",
			fixed_notified_value_or_retail_price=0,
		)
		doc = SimpleNamespace(
			name="STI-0400",
			docstatus=0,
			seller__business_name="Acme",
			buyer="UoE",
			buyer_registration_type="Registered",
			buyer_ntncnic="9020028",
			fbr_environment="Production",
			invoice_date="2026-10-09",
			invoice_type="Sale Invoice",
			scenario_id="SN001",
			fbr_invoice_no="",
			total_sales=13500,
			total_taxes=2430,
			total_sales_with_taxes=15930,
			get=lambda key, default=None: [row] if key == "invoice_items" else default,
		)
		summary = tools.invoice_summary(doc)
		self.assertEqual(summary["status"], "Draft")
		self.assertEqual(summary["buyer_ntn_cnic"], "***0028")
		self.assertEqual(summary["items"][0]["total"], 15930.0)
		self.assertEqual(summary["url"], "/desk/sale-tax-invoice/STI-0400")


BUYER_ROWS = [
	{
		"name": "Shah Traders",
		"buyer_registration_type": "Registered",
		"buyer_ntncnic": "9020028",
		"seller": "Acme",
	},
	{
		"name": "Karim Brothers",
		"buyer_registration_type": "Unregistered",
		"buyer_ntncnic": "3520212345671",
		"seller": None,
	},
	{
		"name": "Block 5 Traders",
		"buyer_registration_type": "Registered",
		"buyer_ntncnic": "1234567",
		"seller": "Acme",
	},
]


class TestSearchBuyers(unittest.TestCase):
	def _search(self, query):
		with (
			patch.object(tools, "frappe", fake_frappe()),
			patch.object(tools, "require_seller", lambda s: s),
			patch.object(tools, "_buyer_list", return_value=[dict(row) for row in BUYER_ROWS]),
		):
			return tools.search_buyers("Acme", query)

	def test_words_match_names_only(self):
		self.assertEqual([row["name"] for row in self._search("Shop 1")["buyers"]], [])
		self.assertEqual(
			[row["name"] for row in self._search("block 5 traders")["buyers"]], ["Block 5 Traders"]
		)
		result = self._search("traders")
		self.assertEqual([row["name"] for row in result["buyers"]], ["Shah Traders", "Block 5 Traders"])
		self.assertEqual(result["exact_match"], "")
		self.assertEqual(self._search("Karim Brothers")["exact_match"], "Karim Brothers")

	def test_a_number_matches_the_tax_id_and_is_masked_in_the_answer(self):
		result = self._search("9020028-3")
		self.assertEqual([row["name"] for row in result["buyers"]], ["Shah Traders"])
		self.assertEqual(result["buyers"][0]["ntn_cnic"], "***0028")
		self.assertEqual(result["buyers"][0]["seller"], "Acme")
		self.assertEqual(
			[row["name"] for row in self._search("35202-1234567-1")["buyers"]], ["Karim Brothers"]
		)
		self.assertEqual(self._search("123")["buyers"], [])
		self.assertEqual(len(self._search("")["buyers"]), 3)


class TestSearchHsCodes(unittest.TestCase):
	def _query_seen(self, query):
		with patch.object(tools.hs_search, "search", return_value=[]) as search:
			tools.search_hs_codes(query, 5)
		return search.call_args.args[0]

	def test_only_a_bare_code_is_normalised(self):
		self.assertEqual(self._query_seen("84212100"), "8421.2100")
		self.assertEqual(self._query_seen("8421 2100"), "8421.2100")
		self.assertEqual(self._query_seen("filter 84212100"), "filter 84212100")
		self.assertEqual(self._query_seen("water filter 8421.2100"), "water filter 8421.2100")


class TestPreviewPayload(unittest.TestCase):
	def test_identities_are_masked_for_the_model(self):
		doc = SimpleNamespace(name="STI-0400")
		payload = {
			"buyerNTNCNIC": "3520212345678",
			"sellerNTNCNIC": "1234567",
			"buyerBusinessName": "UoE",
			"items": [],
		}
		with (
			patch.object(tools, "_load_invoice", return_value=doc),
			patch(
				"di.integrations.sale_tax_invoice_api.build_sale_tax_invoice_payload", return_value=payload
			),
		):
			result = tools.preview_fbr_payload("STI-0400")
		self.assertEqual(result["payload"]["buyerNTNCNIC"], "*********5678")
		self.assertEqual(result["payload"]["sellerNTNCNIC"], "***4567")
		self.assertEqual(result["payload"]["buyerBusinessName"], "UoE")
		self.assertIn("masked", result["note"])


class TestTrim(unittest.TestCase):
	def test_small_results_pass_through_and_big_ones_keep_the_draft_header(self):
		small = {"ok": True, "invoice": {"name": "STI-1"}}
		self.assertIs(tools._trim(small), small)
		big = {
			"ok": True,
			"created": True,
			"invoice": {
				"name": "STI-0400",
				"environment": "Production",
				"grand_total": 15930.0,
				"url": "/desk/sale-tax-invoice/STI-0400",
				"items": [{"item": "x" * 200}] * 80,
			},
			"warnings": ["w"],
		}
		trimmed = tools._trim(big)
		self.assertTrue(trimmed["truncated"])
		self.assertEqual((trimmed["ok"], trimmed["created"]), (True, True))
		self.assertEqual(trimmed["invoice"]["name"], "STI-0400")
		self.assertEqual(trimmed["invoice"]["environment"], "Production")
		self.assertEqual(trimmed["invoice"]["items_count"], 80)
		self.assertNotIn("items", trimmed["invoice"])
		self.assertLessEqual(len(json.dumps(trimmed, ensure_ascii=False)), tools.RESULT_CHARS)
		self.assertTrue(tools._trim([1] * 10000)["truncated"])
