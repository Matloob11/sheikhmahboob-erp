"""Settings for the assistant, resolved once per request.

The API key is looked up in two places and never travels further than the
HTTP client: `DI AI Settings.api_key` (a Password field) first, then
`openai_api_key` in site_config.json, which is where a live site should keep it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import frappe
from frappe import _
from frappe.utils import cint, cstr

SETTINGS_DOCTYPE = "DI AI Settings"
DEFAULT_MODEL = "gpt-6-astra"
DEFAULT_FALLBACKS = ("gpt-6.1-sol", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5")
EFFORTS = ("low", "medium", "high", "xhigh")
# One turn runs inside a desk request that nginx and gunicorn cut at 120 s.
MAX_TURN_BUDGET_SECONDS = 90
DEFAULT_TURN_BUDGET_SECONDS = 75


@dataclass
class AISettings:
	enabled: bool = False
	model: str = DEFAULT_MODEL
	fallback_models: list[str] = field(default_factory=lambda: list(DEFAULT_FALLBACKS))
	reasoning_effort: str = "medium"
	store_on_openai: bool = True
	default_environment: str = "Production"
	max_tool_rounds: int = 8
	turn_budget_seconds: int = DEFAULT_TURN_BUDGET_SECONDS
	max_output_tokens: int = 8000
	daily_messages_per_user: int = 150
	allow_fbr_lookups: bool = True
	allow_fbr_validate: bool = True
	extra_instructions: str = ""
	api_key: str = field(default="", repr=False)
	# Per-turn call counters (write tools, validations); reset by the assistant.
	counters: dict = field(default_factory=dict)

	@property
	def model_chain(self) -> list[str]:
		chain = []
		for name in [self.model, *self.fallback_models]:
			name = cstr(name).strip()
			if name and name not in chain:
				chain.append(name)
		return chain


def split_lines(text) -> list[str]:
	return [line.strip() for line in cstr(text).replace(",", "\n").splitlines() if line.strip()]


def get_settings(*, require_enabled=True) -> AISettings:
	if not frappe.db.exists("DocType", SETTINGS_DOCTYPE):
		frappe.throw(_("DI AI Settings is missing. Run bench migrate for the di app first."))

	doc = frappe.get_single(SETTINGS_DOCTYPE)
	api_key = cstr(doc.get_password("api_key", raise_exception=False) or "").strip()
	if not api_key:
		api_key = cstr(frappe.conf.get("openai_api_key") or "").strip()

	effort = cstr(doc.reasoning_effort).strip() or "medium"
	if effort not in EFFORTS:
		effort = "medium"

	settings = AISettings(
		enabled=bool(cint(doc.enabled)),
		model=cstr(doc.model).strip() or DEFAULT_MODEL,
		fallback_models=split_lines(doc.fallback_models) or list(DEFAULT_FALLBACKS),
		reasoning_effort=effort,
		store_on_openai=bool(cint(doc.store_on_openai)),
		default_environment="Sandbox" if cstr(doc.default_environment) == "Sandbox" else "Production",
		max_tool_rounds=max(1, min(cint(doc.max_tool_rounds) or 8, 20)),
		turn_budget_seconds=max(
			20, min(cint(doc.turn_budget_seconds) or DEFAULT_TURN_BUDGET_SECONDS, MAX_TURN_BUDGET_SECONDS)
		),
		max_output_tokens=max(1024, min(cint(doc.max_output_tokens) or 8000, 32000)),
		daily_messages_per_user=max(0, cint(doc.daily_messages_per_user)),
		allow_fbr_lookups=bool(cint(doc.allow_fbr_lookups)),
		allow_fbr_validate=bool(cint(doc.allow_fbr_validate)),
		extra_instructions=cstr(doc.extra_instructions).strip(),
		api_key=api_key,
	)

	if require_enabled and not settings.enabled:
		frappe.throw(
			_("The AI assistant is switched off. A System Manager can enable it in DI AI Settings."),
			title=_("AI Assistant"),
		)
	return settings


def require_api_key(settings: AISettings) -> str:
	if not settings.api_key:
		frappe.throw(
			_(
				"The AI assistant is not set up yet (no OpenAI API key). A System Manager sets openai_api_key in "
				"site_config.json or on DI AI Settings."
			),
			title=_("AI Assistant"),
		)
	return settings.api_key
