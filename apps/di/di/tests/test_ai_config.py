"""DI AI Settings resolution: key source, clamps, defaults. No site."""

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from di.ai import config


def settings_doc(**overrides):
	base = dict(
		enabled=1,
		model=" gpt-6-astra ",
		fallback_models="gpt-6.1-sol, gpt-6-sol\n\ngpt-6.1-sol",
		reasoning_effort="turbo",
		store_on_openai=1,
		default_environment="Sandbox",
		max_tool_rounds=99,
		turn_budget_seconds=500,
		max_output_tokens=10,
		daily_messages_per_user=-5,
		allow_fbr_lookups=1,
		allow_fbr_validate=0,
		extra_instructions=" be nice ",
		api_key="",
	)
	base.update(overrides)
	doc = SimpleNamespace(**base)
	doc.get_password = lambda field, raise_exception=True: base.get(field, "")
	return doc


def resolve(doc, conf_key="sk-conf", require_enabled=False):
	fake = MagicMock()
	fake.db.exists.return_value = True
	fake.get_single.return_value = doc
	fake.conf.get.side_effect = lambda key, default=None: conf_key if key == "openai_api_key" else default
	fake.throw.side_effect = frappe.ValidationError
	with patch.object(config, "frappe", fake):
		return config.get_settings(require_enabled=require_enabled)


class TestSettings(unittest.TestCase):
	def test_limits_are_clamped_and_the_key_falls_back_to_site_config(self):
		settings = resolve(settings_doc())
		self.assertEqual(settings.model, "gpt-6-astra")
		self.assertEqual(settings.fallback_models, ["gpt-6.1-sol", "gpt-6-sol", "gpt-6.1-sol"])
		self.assertEqual(settings.model_chain, ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol"])
		self.assertEqual(settings.reasoning_effort, "medium")
		self.assertEqual(
			(
				settings.max_tool_rounds,
				settings.turn_budget_seconds,
				settings.max_output_tokens,
				settings.daily_messages_per_user,
			),
			(20, config.MAX_TURN_BUDGET_SECONDS, 1024, 0),
		)
		self.assertEqual(settings.default_environment, "Sandbox")
		self.assertEqual(settings.api_key, "sk-conf")
		self.assertEqual(settings.extra_instructions, "be nice")
		self.assertTrue(settings.allow_fbr_lookups)
		self.assertFalse(settings.allow_fbr_validate)
		self.assertNotIn("sk-conf", repr(settings))

	def test_password_field_wins_over_site_config(self):
		self.assertEqual(resolve(settings_doc(api_key="sk-field")).api_key, "sk-field")
		self.assertEqual(resolve(settings_doc(), conf_key="").api_key, "")

	def test_blank_fields_take_the_defaults(self):
		settings = resolve(
			settings_doc(
				model="",
				fallback_models="",
				reasoning_effort="high",
				default_environment="",
				max_tool_rounds=0,
				turn_budget_seconds=0,
				max_output_tokens=0,
			)
		)
		self.assertEqual(settings.model, config.DEFAULT_MODEL)
		self.assertEqual(settings.fallback_models, list(config.DEFAULT_FALLBACKS))
		self.assertEqual(settings.reasoning_effort, "high")
		self.assertEqual(settings.default_environment, "Production")
		self.assertEqual(
			(settings.max_tool_rounds, settings.turn_budget_seconds, settings.max_output_tokens),
			(8, config.DEFAULT_TURN_BUDGET_SECONDS, 8000),
		)

	def test_disabled_throws_only_when_required(self):
		self.assertFalse(resolve(settings_doc(enabled=0)).enabled)
		with self.assertRaises(frappe.ValidationError):
			resolve(settings_doc(enabled=0), require_enabled=True)

	def test_require_api_key(self):
		fake = MagicMock()
		fake.throw.side_effect = frappe.ValidationError
		with patch.object(config, "frappe", fake):
			self.assertEqual(config.require_api_key(config.AISettings(api_key="sk-x")), "sk-x")
			with self.assertRaises(frappe.ValidationError):
				config.require_api_key(config.AISettings(api_key=""))
