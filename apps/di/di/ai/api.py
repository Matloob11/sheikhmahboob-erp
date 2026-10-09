"""Whitelisted endpoints for the AI Assistant page and the settings form.

Everything that writes or spends money (chat, new/close conversation, the
connection probe) is POST-only: Frappe checks the CSRF token on unsafe methods
only, and the session cookie travels on a cross-site top-level GET.
"""

from __future__ import annotations

import time
from dataclasses import asdict

import frappe
from frappe import _
from frappe.utils import cint, cstr, get_fullname, nowdate

from di.ai import assistant, tools
from di.ai import openai_client as oc
from di.ai.config import get_settings, require_api_key


@frappe.whitelist(methods=["POST"])
def chat(message, conversation=None, invoice=None):
	return assistant.chat(message, conversation=conversation, invoice=invoice)


def _conversations(limit=20):
	return frappe.get_all(
		assistant.CONVERSATION_DOCTYPE,
		filters={"owner": frappe.session.user},
		fields=["name", "title", "status", "draft_invoice", "modified"],
		order_by="modified desc",
		limit_page_length=max(1, min(cint(limit) or 20, 50)),
	)


def quick_prompts(sellers, has_draft=False) -> list[dict]:
	seller = sellers[0] if len(sellers) == 1 else "<company>"
	prompts = [
		{
			"label": _("New invoice"),
			"text": f"{seller} ki <buyer> ko <qty> <item> @ <rate> PKR ki invoice banao",
		},
		{"label": _("Same as last"), "text": "Pichli invoice jaisi nayi draft banao, sirf quantity badal do"},
		{
			"label": _("New buyer"),
			"text": "Naya buyer add karo: <naam>, NTN/CNIC <number>, <province>, <address>",
		},
		{"label": _("HS code"), "text": "<item> ka sahi HS code, UOM aur rate kya hoga?"},
	]
	if has_draft:
		prompts.append(
			{"label": _("Check draft"), "text": "Is draft ko FBR se validate karo aur errors samjhao"}
		)
	return prompts


@frappe.whitelist()
def bootstrap(invoice=None):
	"""Everything the page needs on load. Never raises for a disabled assistant."""
	role = tools.current_user_role()
	out = {
		"enabled": False,
		"role": role,
		"user": frappe.session.user,
		"full_name": get_fullname(frappe.session.user),
		"sellers": [],
		"fixed_seller": "",
		"environment": "",
		"quick_prompts": [],
		"conversations": [],
		"remaining_today": None,
		"allow_validate": False,
		"reason": "",
	}
	if not role:
		out["reason"] = _(
			"The AI assistant is available to System Managers and Client Panel users. The demo account is read-only."
		)
		return out
	try:
		settings = get_settings(require_enabled=False)
	except Exception as exc:
		out["reason"] = cstr(exc)
		return out

	if not settings.enabled:
		out["reason"] = _(
			"The AI assistant is switched off. A System Manager can enable it in DI AI Settings."
		)
	elif not settings.api_key:
		out["reason"] = _(
			"The AI assistant is not set up yet (no OpenAI key). Ask the Sheikh Mahboob office."
		)
	else:
		out["enabled"] = True

	out["sellers"] = tools.allowed_sellers()
	out["fixed_seller"] = tools.fixed_seller() or ""
	out["environment"] = tools.effective_environment(settings)
	out["model"] = settings.model
	out["allow_validate"] = bool(settings.allow_fbr_validate)
	out["remaining_today"] = assistant.remaining_today(settings)
	out["conversations"] = _conversations(10)

	invoice = cstr(invoice).strip()
	if invoice:
		doc = assistant._readable_invoice(invoice)
		if doc is not None:
			out["invoice"] = tools.invoice_summary(doc)
		else:
			# Shown by the page in an alert; the name came from the URL.
			out["invoice_error"] = _("Invoice {0} was not found.").format(frappe.utils.escape_html(invoice))
	out["quick_prompts"] = quick_prompts(out["sellers"], has_draft=bool(out.get("invoice")))
	return out


@frappe.whitelist()
def list_conversations(limit=20):
	assistant.check_access()
	return _conversations(limit)


@frappe.whitelist()
def get_conversation(name):
	assistant.check_access()
	return assistant.conversation_payload(assistant.load_conversation(name))


@frappe.whitelist(methods=["POST"])
def new_conversation(invoice=None):
	assistant.check_access()
	get_settings(require_enabled=True)
	return assistant.conversation_payload(assistant.new_conversation(invoice))


@frappe.whitelist(methods=["POST"])
def close_conversation(name):
	assistant.check_access()
	conv = assistant.load_conversation(name)
	conv.status = "Closed"
	conv.save(ignore_permissions=True)
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
def test_connection():
	"""List the models this key can see, then make one small call. Returns nothing secret."""
	frappe.only_for("System Manager")
	settings = get_settings(require_enabled=False)
	api_key = require_api_key(settings)
	client = oc.OpenAIClient(api_key)

	started = time.monotonic()
	try:
		models = client.list_models()
	except oc.OpenAIError as exc:
		frappe.throw(assistant.user_message(exc), title=_("Test connection"))
	chain = [{"model": name, "available": name in models} for name in settings.model_chain]
	selected = next((name for name in settings.model_chain if name in models), None)
	result = {
		"models_visible": len(models),
		"gpt_models": [name for name in models if name.startswith(("gpt-5", "gpt-6", "o"))][:40],
		"chain": chain,
		"selected_model": selected,
		"effort": settings.reasoning_effort,
		"list_latency_ms": int((time.monotonic() - started) * 1000),
	}
	if not selected:
		result["warning"] = _(
			"None of the configured models is visible to this key. Pick one from gpt_models."
		)
		return result

	started = time.monotonic()
	try:
		# Reasoning tokens count against max_output_tokens, so the cap is generous
		# and success is judged on status, not on the length of the reply.
		response = client.create_response(
			model=selected,
			input=[{"role": "user", "content": "Reply with the single word OK."}],
			instructions="You are a connectivity probe.",
			reasoning_effort=settings.reasoning_effort,
			max_output_tokens=2048,
			store=False,
			timeout=(10, 60),
		)
	except oc.OpenAIError as exc:
		result["warning"] = assistant.user_message(exc)
		return result
	result["status"] = response.get("status")
	result["reply"] = oc.output_text(response)
	result["call_latency_ms"] = int((time.monotonic() - started) * 1000)
	result["usage"] = asdict(oc.usage(response))
	if response.get("status") != "completed":
		result["warning"] = _(
			"The model answered with status {0} ({1}); the key works but the budget may be too small."
		).format(response.get("status"), oc.incomplete_reason(response) or oc.failure(response) or "")
	return result


@frappe.whitelist()
def usage_summary(days=30):
	frappe.only_for("System Manager")
	days = max(1, min(cint(days) or 30, 365))
	since = frappe.utils.add_days(nowdate(), -days)
	by_day = frappe.db.sql(
		"""
		select date(m.created_at) as day, count(*) as turns,
			sum(m.input_tokens) as input_tokens, sum(m.output_tokens) as output_tokens
		from `tabDI AI Message` m
		where m.role = 'assistant' and m.created_at >= %(since)s
		group by date(m.created_at) order by day desc
		""",
		{"since": since},
		as_dict=True,
	)
	by_user = frappe.db.sql(
		"""
		select c.owner as user, count(*) as turns,
			sum(m.input_tokens) as input_tokens, sum(m.output_tokens) as output_tokens
		from `tabDI AI Message` m
		join `tabDI AI Conversation` c on c.name = m.parent
		where m.role = 'assistant' and m.created_at >= %(since)s
		group by c.owner order by turns desc
		""",
		{"since": since},
		as_dict=True,
	)
	return {"days": days, "by_day": by_day, "by_user": by_user}
