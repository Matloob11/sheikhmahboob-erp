"""The page and settings-form endpoints: HTTP methods, bootstrap, the connection probe. No site, no network."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from di.ai import api
from di.ai import openai_client as oc
from di.ai.config import AISettings


class TestEndpointMethods(unittest.TestCase):
	def test_state_changing_endpoints_are_post_only(self):
		# Frappe checks the CSRF token on unsafe methods only, and the session cookie travels
		# on a cross-site top-level GET: anything that writes or spends money must refuse GET.
		registry = frappe.allowed_http_methods_for_whitelisted_func
		for func in (api.chat, api.new_conversation, api.close_conversation, api.test_connection):
			self.assertEqual(registry[func], ["POST"], func.__name__)
		for func in (api.bootstrap, api.list_conversations, api.get_conversation, api.usage_summary):
			self.assertIn("GET", registry[func], func.__name__)


class TestBootstrap(unittest.TestCase):
	def _fake(self):
		fake = MagicMock()
		fake.session = SimpleNamespace(user="clerk@example.com")
		fake.utils = frappe.utils
		fake.get_all.return_value = [{"name": "CONV-1"}]
		return fake

	def _boot(self, role, settings, sellers, invoice=None, readable=None):
		settings_patch = (
			{"side_effect": settings} if isinstance(settings, Exception) else {"return_value": settings}
		)
		with (
			patch.object(api, "frappe", self._fake()),
			patch.object(api, "get_fullname", return_value="Clerk"),
			patch.object(api, "get_settings", **settings_patch),
			patch.object(api.tools, "current_user_role", return_value=role),
			patch.object(api.tools, "allowed_sellers", return_value=sellers),
			patch.object(api.assistant, "remaining_today", return_value=12),
			patch.object(api.assistant, "_readable_invoice", return_value=readable),
			patch.object(api.tools, "invoice_summary", lambda d: {"name": d.name}),
		):
			return api.bootstrap(invoice)

	def test_no_role_gets_a_reason_and_no_data(self):
		out = self._boot(None, AISettings(), ["Acme"])
		self.assertFalse(out["enabled"])
		self.assertIn("read-only", out["reason"])
		self.assertEqual(out["sellers"], [])
		self.assertEqual(out["conversations"], [])

	def test_settings_failure_is_a_reason_not_a_crash(self):
		out = self._boot("System Manager", RuntimeError("DI AI Settings is missing"), ["Acme"])
		self.assertEqual(out["reason"], "DI AI Settings is missing")
		self.assertFalse(out["enabled"])

	def test_panel_user_sees_production_and_a_fixed_seller(self):
		out = self._boot(
			"DI Panel User",
			AISettings(enabled=True, api_key="sk-x", default_environment="Sandbox", allow_fbr_validate=False),
			["Acme"],
		)
		self.assertTrue(out["enabled"])
		self.assertEqual(
			(
				out["environment"],
				out["fixed_seller"],
				out["sellers"],
				out["allow_validate"],
				out["remaining_today"],
			),
			("Production", "Acme", ["Acme"], False, 12),
		)
		self.assertEqual(len(out["quick_prompts"]), 4)
		self.assertTrue(out["quick_prompts"][0]["text"].startswith("Acme ki"))
		self.assertEqual(out["conversations"], [{"name": "CONV-1"}])
		self.assertNotIn("sk-x", json.dumps(out))

	def test_admin_disabled_and_no_key(self):
		out = self._boot(
			"System Manager",
			AISettings(enabled=False, api_key="sk-x", default_environment="Sandbox"),
			["Acme", "Beta"],
		)
		self.assertFalse(out["enabled"])
		self.assertIn("switched off", out["reason"])
		self.assertEqual((out["environment"], out["fixed_seller"]), ("Sandbox", ""))
		self.assertTrue(out["quick_prompts"][0]["text"].startswith("<company> ki"))
		out = self._boot("System Manager", AISettings(enabled=True, api_key=""), ["Acme"])
		self.assertFalse(out["enabled"])
		self.assertIn("no OpenAI key", out["reason"])

	def test_invoice_context(self):
		out = self._boot(
			"System Manager", AISettings(enabled=True, api_key="sk-x"), ["Acme"], invoice="STI-0001"
		)
		self.assertIn("STI-0001", out["invoice_error"])
		self.assertNotIn("invoice", out)
		self.assertEqual(len(out["quick_prompts"]), 4)
		out = self._boot(
			"System Manager",
			AISettings(enabled=True, api_key="sk-x"),
			["Acme"],
			invoice="STI-0400",
			readable=SimpleNamespace(name="STI-0400"),
		)
		self.assertEqual(out["invoice"], {"name": "STI-0400"})
		self.assertEqual(out["quick_prompts"][-1]["label"], "Check draft")
		self.assertEqual(len(out["quick_prompts"]), 5)
		# The name comes from the URL and the page shows this text in an alert.
		out = self._boot(
			"System Manager", AISettings(enabled=True, api_key="sk-x"), ["Acme"], invoice="<b>x</b>"
		)
		self.assertIn("&lt;b&gt;x&lt;/b&gt;", out["invoice_error"])
		self.assertNotIn("<b>", out["invoice_error"])


class TestTestConnection(unittest.TestCase):
	def _run(self, client, settings):
		fake = MagicMock()
		fake.throw.side_effect = frappe.ValidationError
		with (
			patch.object(api, "frappe", fake),
			patch.object(api, "get_settings", return_value=settings),
			patch.object(api.oc, "OpenAIClient", return_value=client),
		):
			return api.test_connection(), fake

	def _ok_response(self):
		return {
			"id": "r",
			"status": "completed",
			"output": [{"type": "message", "content": [{"type": "output_text", "text": "OK"}]}],
			"usage": {"input_tokens": 10, "output_tokens": 2},
		}

	def test_reports_chain_and_probe(self):
		client = MagicMock()
		client.list_models.return_value = ["gpt-4.1", "gpt-6-astra", "gpt-6.1-sol", "o3"]
		client.create_response.return_value = self._ok_response()
		settings = AISettings(
			enabled=True,
			api_key="sk-x",
			model="gpt-6-sol",
			fallback_models=["gpt-6.1-sol"],
			reasoning_effort="low",
		)
		result, fake = self._run(client, settings)
		fake.only_for.assert_called_once_with("System Manager")
		self.assertEqual(
			result["chain"],
			[{"model": "gpt-6-sol", "available": False}, {"model": "gpt-6.1-sol", "available": True}],
		)
		self.assertEqual(result["selected_model"], "gpt-6.1-sol")
		self.assertEqual(result["gpt_models"], ["gpt-6-astra", "gpt-6.1-sol", "o3"])
		self.assertEqual(result["models_visible"], 4)
		self.assertEqual(
			(result["status"], result["reply"], result["usage"]["input_tokens"]), ("completed", "OK", 10)
		)
		self.assertNotIn("warning", result)
		self.assertNotIn("sk-x", json.dumps(result))
		kw = client.create_response.call_args.kwargs
		self.assertEqual(
			(kw["model"], kw["store"], kw["max_output_tokens"], kw["reasoning_effort"], kw["timeout"]),
			("gpt-6.1-sol", False, 2048, "low", (10, 60)),
		)

	def test_no_visible_model_skips_the_probe(self):
		client = MagicMock()
		client.list_models.return_value = ["gpt-4o"]
		result, _fake = self._run(
			client, AISettings(enabled=True, api_key="sk-x", model="gpt-6-sol", fallback_models=[])
		)
		self.assertIn("None of the configured models", result["warning"])
		client.create_response.assert_not_called()
		self.assertNotIn("status", result)

	def test_probe_failure_is_a_warning(self):
		client = MagicMock()
		client.list_models.return_value = ["gpt-6-sol"]
		client.create_response.side_effect = oc.OpenAIRateLimited("x", status=429, quota=True)
		result, fake = self._run(
			client, AISettings(enabled=True, api_key="sk-x", model="gpt-6-sol", fallback_models=[])
		)
		self.assertIn("credit", result["warning"])
		fake.throw.assert_not_called()
		self.assertNotIn("status", result)

	def test_incomplete_probe_is_flagged(self):
		client = MagicMock()
		client.list_models.return_value = ["gpt-6-sol"]
		client.create_response.return_value = {
			"id": "r",
			"status": "incomplete",
			"incomplete_details": {"reason": "max_output_tokens"},
			"output": [],
			"usage": {},
		}
		result, _fake = self._run(
			client, AISettings(enabled=True, api_key="sk-x", model="gpt-6-sol", fallback_models=[])
		)
		self.assertIn("incomplete", result["warning"])
		self.assertIn("max_output_tokens", result["warning"])
		self.assertEqual(result["status"], "incomplete")

	def test_list_failure_throws_and_names_the_key(self):
		client = MagicMock()
		client.list_models.side_effect = oc.OpenAIAuthError("bad", status=401)
		with self.assertRaises(frappe.ValidationError):
			self._run(client, AISettings(enabled=True, api_key="sk-x"))
		client.create_response.assert_not_called()
		fake = MagicMock()
		fake.throw.side_effect = frappe.ValidationError
		with (
			patch.object(api, "frappe", fake),
			patch.object(api, "get_settings", return_value=AISettings(enabled=True, api_key="sk-x")),
			patch.object(api.oc, "OpenAIClient", return_value=client),
		):
			with self.assertRaises(frappe.ValidationError):
				api.test_connection()
		self.assertIn("key", fake.throw.call_args.args[0])
