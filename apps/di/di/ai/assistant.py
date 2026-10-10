"""One turn of the assistant.

Build the instructions and the input, call the model, run the tools it asks
for, call again, and when it finally answers in words persist everything on
the conversation. The user's message is committed before the first model call
and every write tool commits for itself, so a failure half-way leaves a true
record of what happened rather than a rolled-back blank.

The turn runs inside the desk request, which nginx and gunicorn cut at 120 s.
Every model call is given only the time that is left, nothing starts with less
than a few seconds in hand, and one user cannot run two turns at once.
"""

from __future__ import annotations

import json
import time

import frappe
from frappe import _
from frappe.utils import cint, cstr, get_fullname, now_datetime, nowdate

from di.ai import openai_client as oc
from di.ai import prompts, rules, tools
from di.ai.config import AISettings, get_settings, require_api_key
from di.constants import PRODUCT_UOM_OPTIONS, SRO_REQUIRED_SALE_TYPES
from di.fbr_scenarios import FBR_SCENARIOS

CONVERSATION_DOCTYPE = "DI AI Conversation"
MAX_MESSAGE_CHARS = 4000
HISTORY_MESSAGES = 20
# Tool results are trimmed to tools.RESULT_CHARS before the model sees them; the stored
# copy must hold all of it, or a reopened chat shows a successful step as failed.
LOG_CHARS = 12000
REALTIME_EVENT = "di_ai_progress"
# Keep a little of the turn budget for persisting the result.
BUDGET_MARGIN_SECONDS = 4
MIN_CALL_SECONDS = 10
MAX_READ_TIMEOUT = 60
# A chain this long is re-billed on every call; start again from local history.
FRESH_CHAIN_INPUT_TOKENS = 60000
LOCK_KEY = "di_ai:turn:{user}"
ACTIVE_KEY = "di_ai:active"
# A turn holds a gunicorn worker for up to 90 s; the assistant never takes every worker.
DEFAULT_GUNICORN_WORKERS = 3

WRAP_UP_NUDGE = (
	"Stop calling tools now. In the user's language, say what you did (name any draft you created or "
	"changed), what is still missing, and what the user should do next."
)


class TurnBudget:
	def __init__(self, seconds):
		self.seconds = float(seconds)
		self.started = time.monotonic()

	def remaining(self) -> float:
		return max(0.0, self.seconds - (time.monotonic() - self.started))

	def exhausted(self, margin=0.0) -> bool:
		return self.remaining() <= margin


def progress(conversation, step, detail=""):
	"""Best-effort live status line for the page; never fails the turn."""
	try:
		frappe.publish_realtime(
			REALTIME_EVENT,
			{"conversation": conversation, "step": step, "detail": cstr(detail)[:200]},
			user=frappe.session.user,
		)
	except Exception:
		pass


def check_access() -> str:
	role = tools.current_user_role()
	if not role:
		frappe.throw(
			_("The AI assistant is available to System Managers and Client Panel users."),
			frappe.PermissionError,
		)
	return role


def load_conversation(name):
	name = cstr(name).strip()
	if not name or not frappe.db.exists(CONVERSATION_DOCTYPE, name):
		frappe.throw(_("Conversation not found."), frappe.DoesNotExistError)
	doc = frappe.get_doc(CONVERSATION_DOCTYPE, name)
	if doc.owner != frappe.session.user and tools.current_user_role() != "System Manager":
		frappe.throw(_("This conversation belongs to another user."), frappe.PermissionError)
	return doc


def _readable_invoice(name):
	"""The invoice when it exists and the user may read it, else None."""
	name = cstr(name).strip()
	if not name or not frappe.db.exists(tools.INVOICE_DOCTYPE, name):
		return None
	doc = frappe.get_doc(tools.INVOICE_DOCTYPE, name)
	if not frappe.has_permission(tools.INVOICE_DOCTYPE, "read", doc=doc):
		return None
	return doc


def new_conversation(invoice=None):
	doc = frappe.get_doc({"doctype": CONVERSATION_DOCTYPE, "user": frappe.session.user, "status": "Active"})
	invoice = cstr(invoice).strip()
	if invoice:
		context_doc = _readable_invoice(invoice)
		if not context_doc:
			# msgprint renders HTML; the name came from the client.
			frappe.throw(
				_("Invoice {0} was not found.").format(frappe.utils.escape_html(invoice)),
				frappe.PermissionError,
			)
		doc.invoice_context = context_doc.name
		doc.seller = context_doc.seller__business_name
		if cint(context_doc.docstatus) == 0:
			doc.draft_invoice = context_doc.name
		doc.title = _("About {0}").format(context_doc.name)
	# Panel users hold read-only rights on conversations; the server writes them.
	doc.insert(ignore_permissions=True)
	return doc


def _save(doc):
	doc.save(ignore_permissions=True)


def daily_message_count(user) -> int:
	rows = frappe.db.sql(
		"""
		select count(*)
		from `tabDI AI Message` m
		join `tabDI AI Conversation` c on c.name = m.parent
		where c.owner = %(user)s and m.role = 'user' and m.created_at >= %(start)s
		""",
		{"user": user, "start": f"{nowdate()} 00:00:00"},
	)
	return cint(rows[0][0]) if rows else 0


def remaining_today(settings: AISettings, user=None) -> int | None:
	cap = cint(settings.daily_messages_per_user)
	if not cap:
		return None
	return max(0, cap - daily_message_count(user or frappe.session.user))


def check_daily_cap(settings: AISettings):
	left = remaining_today(settings)
	if left is not None and left <= 0:
		frappe.throw(
			_("You have reached today's limit of {0} assistant messages. Try again tomorrow.").format(
				settings.daily_messages_per_user
			),
			title=_("AI Assistant"),
		)


def _cache_key(key):
	"""Site-prefixed like every other Frappe cache key; redis-py's raw set/incr/delete do not prefix."""
	try:
		return frappe.cache.make_key(key)
	except Exception:
		return key


def _log_cache_failure(title):
	"""Keep a record of a cache failure for the System Manager.

	chat() throws right after this, and Frappe rolls the request's transaction back on
	an exception, so the Error Log row is committed here or it would never exist.
	"""
	try:
		frappe.log_error(frappe.get_traceback(), title)
		frappe.db.commit()
	except Exception:
		pass


def acquire_turn_lock(user, ttl_seconds):
	"""One turn per user at a time; a second request is refused, not queued.

	True when the lock was taken, False when the user already holds one, None when
	the cache failed: the lock is what keeps one login from holding two workers, so a
	failure refuses the turn (fail closed) and is logged.
	"""
	try:
		return bool(
			frappe.cache.set(_cache_key(LOCK_KEY.format(user=user)), "1", nx=True, ex=int(ttl_seconds))
		)
	except Exception:
		_log_cache_failure("DI AI turn lock failed")
		return None


def release_turn_lock(user):
	try:
		frappe.cache.delete(_cache_key(LOCK_KEY.format(user=user)))
	except Exception:
		pass


def max_concurrent_turns() -> int:
	"""How many turns may run at once: `di_ai_max_concurrent_turns` in site config, else workers - 1."""
	configured = cint(frappe.conf.get("di_ai_max_concurrent_turns"))
	if configured > 0:
		return configured
	workers = cint(frappe.conf.get("gunicorn_workers")) or DEFAULT_GUNICORN_WORKERS
	return max(1, workers - 1)


def acquire_turn_slot(ttl_seconds):
	"""A site-wide count of running turns, so desk and FBR requests always have a worker left.

	True when a slot is free, False when the site is full, None when the cache failed.
	INCR and EXPIRE run in one transaction and every acquire refreshes the TTL, so the
	key can only expire after `ttl` seconds with no new turn, by which time every
	admitted turn has ended: no slot vanishes mid-run, and the +1 of a crashed worker
	heals after one idle TTL.
	"""
	key = _cache_key(ACTIVE_KEY)
	try:
		pipe = frappe.cache.pipeline()
		pipe.incr(key)
		pipe.expire(key, int(ttl_seconds))
		active = cint(pipe.execute()[0])
		if active > max_concurrent_turns():
			frappe.cache.decr(key)
			return False
		return True
	except Exception:
		_log_cache_failure("DI AI turn slot failed")
		return None


def release_turn_slot():
	key = _cache_key(ACTIVE_KEY)
	try:
		if cint(frappe.cache.decr(key)) < 0:
			frappe.cache.delete(key)
	except Exception:
		pass


def _seller_context(name) -> dict:
	doc = frappe.get_doc(tools.SELLER_DOCTYPE, name)
	# No free-text fields (address): a seller record is tenant-editable and this text
	# lands in every administrator's instructions.
	return {
		"name": name,
		"ntn_cnic": rules.mask_identity(doc.seller_ntncnic),
		"province": doc.seller_province,
		"has_sandbox_token": bool(
			cstr(doc.get_password("sandbox_token", raise_exception=False) or "").strip()
		),
		"has_production_token": bool(
			cstr(doc.get_password("production_token", raise_exception=False) or "").strip()
		),
	}


def build_static_context(settings: AISettings, role) -> dict:
	"""Stable for a user: goes into `instructions` so the prompt cache can reuse it."""
	sellers = [_seller_context(name) for name in tools.allowed_sellers()]
	scenarios = []
	for sn_no, description, sale_type in FBR_SCENARIOS:
		scenarios.append(
			{
				"scenario": sn_no,
				"sale_type": sale_type,
				"buyer": rules.scenario_buyer_kind(sn_no),
				"description": description,
			}
		)
	sale_types = []
	for name in rules.known_sale_types():
		sale_types.append({"name": name, "requires_sro": name in SRO_REQUIRED_SALE_TYPES})
	return {
		"user_role": role,
		"sellers": sellers,
		"fixed_seller": tools.fixed_seller() or "",
		"sale_types": sale_types,
		"scenarios": scenarios,
		"uoms": list(PRODUCT_UOM_OPTIONS),
		"provinces": list(rules.PROVINCES),
		"fbr_lookups_enabled": settings.allow_fbr_lookups,
		"fbr_validate_enabled": settings.allow_fbr_validate,
	}


def build_turn_context(settings: AISettings, conv, role) -> dict:
	"""Changes every turn: a short developer message, not part of the cached prefix."""
	environment = tools.effective_environment(settings)
	context = {
		"today": nowdate(),
		"user": {"name": frappe.session.user, "full_name": get_fullname(frappe.session.user), "role": role},
		"ENVIRONMENT": environment,
		"environment_rule": (
			"Client panel accounts file on Production only; there is no sandbox for this login."
			if role == "DI Panel User"
			else "Use the environment the user names; otherwise ENVIRONMENT."
		),
		"fixed_seller": tools.fixed_seller() or "",
	}
	for key, field in (("invoice_in_context", "invoice_context"), ("current_draft", "draft_invoice")):
		doc = _readable_invoice(conv.get(field))
		if doc is not None:
			try:
				context[key] = tools.invoice_summary(doc)
			except Exception:
				pass
	return context


def history_items(conv) -> list[dict]:
	rows = [
		row
		for row in conv.get("messages") or []
		if row.role in ("user", "assistant") and cstr(row.content).strip()
	]
	return [
		{
			"role": "user" if row.role == "user" else "assistant",
			"content": cstr(row.content)[: MAX_MESSAGE_CHARS * 2],
		}
		for row in rows[-HISTORY_MESSAGES:]
	]


class Turn:
	def __init__(
		self, client, settings: AISettings, conv, instructions, turn_context, tool_defs, budget: TurnBudget
	):
		self.client = client
		self.settings = settings
		self.conv = conv
		self.instructions = instructions
		self.turn_context = turn_context
		self.tool_defs = tool_defs
		self.budget = budget
		self.model = None
		self.last_response_id = None
		self.usage = oc.Usage()
		self.rows = []
		self.actions = []
		self.draft = None
		self.model_calls = 0
		self.largest_input = 0
		self.chain_broken = False
		# Raised once per turn when reasoning ate the output cap; every later call keeps it.
		self.output_cap = None
		self.retried_cap = False

	def _timeout(self):
		read = int(min(MAX_READ_TIMEOUT, max(5, self.budget.remaining() - BUDGET_MARGIN_SECONDS)))
		return (10, read)

	def _can_call(self) -> bool:
		return self.budget.remaining() >= MIN_CALL_SECONDS + BUDGET_MARGIN_SECONDS

	def call(self, input_items, previous, tool_choice="auto", *, max_output_tokens=None):
		chain = [self.model] if self.model else self.settings.model_chain
		last_exc = None
		for model in chain:
			try:
				response = self.client.create_response(
					model=model,
					input=input_items,
					instructions=self.instructions,
					tools=self.tool_defs,
					tool_choice=tool_choice,
					previous_response_id=previous,
					reasoning_effort=self.settings.reasoning_effort,
					max_output_tokens=max_output_tokens or self.settings.max_output_tokens,
					store=self.settings.store_on_openai,
					prompt_cache_key=f"di-ai-{frappe.session.user}",
					timeout=self._timeout(),
					retry_budget=max(0.0, self.budget.remaining() - MIN_CALL_SECONDS),
				)
			except oc.OpenAIModelNotFound as exc:
				last_exc = exc
				continue
			self.model = model
			self.model_calls += 1
			self.last_response_id = response.get("id") or self.last_response_id
			used = oc.usage(response)
			self.usage.input_tokens += used.input_tokens
			self.usage.output_tokens += used.output_tokens
			self.usage.cached_tokens += used.cached_tokens
			self.usage.reasoning_tokens += used.reasoning_tokens
			self.largest_input = max(self.largest_input, used.input_tokens)
			failed = oc.failure(response)
			if failed:
				raise oc.OpenAIBadRequest(
					f"OpenAI response failed: {failed}", status=200, code="response_failed"
				)
			return response
		raise last_exc or oc.OpenAIModelNotFound(
			"No configured model is available to this API key.", status=404
		)

	def record_tool(self, call, args, result, duration_ms):
		name = call["name"]
		ok = bool(result.get("ok")) if isinstance(result, dict) else False
		self.rows.append(
			{
				"role": "tool",
				"tool_name": name,
				"tool_call_id": call["call_id"],
				"tool_args": json.dumps(args, default=str, ensure_ascii=False)[:LOG_CHARS],
				"tool_result": json.dumps(result, default=str, ensure_ascii=False)[:LOG_CHARS],
				"duration_ms": int(duration_ms),
				"created_at": now_datetime(),
			}
		)
		summary = ""
		if isinstance(result, dict):
			invoice = result.get("invoice") if isinstance(result.get("invoice"), dict) else None
			if (
				ok
				and invoice
				and invoice.get("name")
				and name in ("create_draft_invoice", "update_draft_invoice")
			):
				self.draft = invoice["name"]
				summary = f"{invoice['name']} ({invoice.get('environment') or ''})".strip()
			elif not ok:
				summary = rules.clip(result.get("error"), 160)
		self.actions.append({"tool": name, "ok": ok, "summary": summary})

	def run_tools(self, calls) -> list[dict]:
		outputs = []
		for call in calls:
			if call.get("incomplete"):
				# Cut off by max_output_tokens: the arguments are not JSON; never run it.
				outputs.append(
					oc.function_call_output(
						call["call_id"],
						{
							"ok": False,
							"error": "This call was cut off before its arguments were complete (output limit). Call it again.",
						},
					)
				)
				continue
			if self.budget.exhausted(BUDGET_MARGIN_SECONDS + 2):
				outputs.append(
					oc.function_call_output(
						call["call_id"],
						{
							"ok": False,
							"error": "Out of time for this turn; this call was not executed. Summarise what is done and what remains.",
						},
					)
				)
				continue
			args = oc.parse_arguments(call["arguments"])
			progress(self.conv.name, "tool", call["name"])
			started = time.monotonic()
			result = tools.run_tool(call["name"], args, self.settings)
			self.record_tool(call, args, result, (time.monotonic() - started) * 1000)
			outputs.append(oc.function_call_output(call["call_id"], result))
		return outputs

	def _fresh_input(self, message, replay) -> list[dict]:
		items = history_items(self.conv) if replay else []
		rows = self.conv.get("messages") or []
		# chat() commits the user's message before the turn runs, so a replayed history
		# ends with its stored copy, which Frappe's XSS filter may have altered ("<item>"
		# placeholders vanish). Drop that row by position and send the message once,
		# verbatim, after the turn context.
		if (
			items
			and rows
			and rows[-1].role == "user"
			and cstr(rows[-1].content).strip()
			and items[-1]["role"] == "user"
		):
			items.pop()
		items.append({"role": "developer", "content": prompts.build_turn_context(self.turn_context)})
		items.append({"role": "user", "content": message})
		return items

	def _raise_cap(self, response) -> bool:
		"""Once per turn: when reasoning ate the output cap, double it for every later call."""
		if self.retried_cap or oc.incomplete_reason(response) != "max_output_tokens":
			return False
		self.retried_cap = True
		self.output_cap = min(self.settings.max_output_tokens * 2, 32000)
		return True

	def run(self, message) -> str:
		stored = bool(self.settings.store_on_openai)
		previous = (cstr(self.conv.last_response_id).strip() or None) if stored else None
		replayed = not previous
		input_items = self._fresh_input(message, replay=replayed)
		text = ""
		rounds = 0

		# A round is one model call that was not abandoned; the cap retry costs none.
		while rounds <= self.settings.max_tool_rounds and self._can_call():
			progress(self.conv.name, "thinking", _("Thinking (step {0})").format(rounds + 1))
			try:
				response = self.call(
					input_items, previous if stored else None, max_output_tokens=self.output_cap
				)
			except oc.OpenAIBadRequest as exc:
				stale = oc.is_previous_response_error(exc) or oc.is_context_length_error(exc)
				if stale and previous and not replayed and not self.rows:
					# OpenAI no longer holds the earlier state (or it outgrew the window): replay
					# our own copy once. Only before any tool ran; later the model must not
					# forget the writes it just made, so the turn fails and the next one replays.
					previous = None
					replayed = True
					self.chain_broken = True
					input_items = self._fresh_input(message, replay=True)
					response = self.call(input_items, None, max_output_tokens=self.output_cap)
				else:
					raise
			calls = oc.function_calls(response)
			complete = [call for call in calls if not call.get("incomplete")]
			reply = oc.output_text(response)
			if not reply and not complete and self._raise_cap(response):
				# Reasoning ate the cap before anything usable came back. Nothing chains on
				# this response: the same input goes once more, with more room for every call
				# left in this turn.
				self.last_response_id = previous
				continue
			rounds += 1
			previous = response.get("id")
			if stored:
				# The chain now holds everything sent so far; only tool outputs produced
				# after this point may be sent again (wrap_up re-sends input_items).
				input_items = []
			else:
				# A cut-off call cannot be replayed (its arguments are not JSON); drop it.
				calls = complete
			if not calls:
				text = reply
				break
			outputs = self.run_tools(calls)
			if stored:
				input_items = outputs
			else:
				input_items = list(input_items) + oc.replayable_output(response.get("output")) + outputs

		if not text:
			text = self.wrap_up(input_items, previous, stored)
		if self.largest_input > FRESH_CHAIN_INPUT_TOKENS:
			self.chain_broken = True
		return text

	def wrap_up(self, input_items, previous, stored) -> str:
		nudge = {"role": "developer", "content": WRAP_UP_NUDGE}
		items = [*input_items, nudge]
		if not self._can_call():
			self.last_response_id = None
			return self.fallback_text()
		progress(self.conv.name, "thinking", _("Writing the summary"))
		try:
			response = self.call(
				items, previous if stored else None, tool_choice="none", max_output_tokens=self.output_cap
			)
			if not oc.output_text(response) and self._raise_cap(response) and self._can_call():
				# Reasoning ate the cap once more: one try with more room, branching from the
				# same point rather than chaining on the empty answer.
				response = self.call(
					items, previous if stored else None, tool_choice="none", max_output_tokens=self.output_cap
				)
		except oc.OpenAIError:
			# Pending tool outputs were never answered on the server side; do
			# not chain the next turn onto that response.
			self.last_response_id = None
			return self.fallback_text()
		return oc.output_text(response) or self.fallback_text()

	def fallback_text(self) -> str:
		if self.draft:
			return _(
				"Draft {0} was created or changed, but the assistant ran out of time before writing a summary. "
				"Open the draft and check its lines."
			).format(self.draft)
		return _("The assistant ran out of time before finishing. Please try again with a shorter request.")


def user_message(exc) -> str:
	if isinstance(exc, oc.OpenAIAuthError):
		return _(
			"The AI assistant is not set up correctly (OpenAI key missing or invalid). A System Manager must fix it in DI AI Settings."
		)
	if isinstance(exc, oc.OpenAIModelNotFound):
		return _(
			"None of the configured models is available to this API key. Check Model and Fallback Models in DI AI Settings."
		)
	if isinstance(exc, oc.OpenAIRateLimited):
		if getattr(exc, "quota", False):
			return _(
				"The OpenAI account has run out of credit or hit its spending limit. A System Manager must top it up."
			)
		return _("OpenAI is busy right now. Wait a minute and try again.")
	if isinstance(exc, oc.OpenAIUnavailable):
		return _("OpenAI did not respond. Try again in a moment.")
	return _("OpenAI rejected the request: {0}").format(rules.clip(cstr(exc), 300))


def _record_failure(conv, turn, exc):
	for row in turn.rows:
		conv.append("messages", row)
	conv.append(
		"messages", {"role": "error", "content": rules.clip(cstr(exc), 1000), "created_at": now_datetime()}
	)
	conv.last_error = rules.clip(cstr(exc), 500)
	if turn.draft:
		conv.draft_invoice = turn.draft
	if turn.model:
		conv.model = turn.model
	conv.last_response_id = None
	conv.total_input_tokens = cint(conv.total_input_tokens) + turn.usage.input_tokens
	conv.total_output_tokens = cint(conv.total_output_tokens) + turn.usage.output_tokens
	_save(conv)
	frappe.db.commit()


def conversation_payload(conv) -> dict:
	messages = []
	for row in conv.get("messages") or []:
		item = {
			"role": row.role,
			"content": cstr(row.content),
			"tool_name": row.tool_name or "",
			"created_at": cstr(row.created_at),
		}
		if row.role == "tool":
			raw = cstr(row.tool_result)
			try:
				result = json.loads(raw or "{}")
			except ValueError:
				# A stored result cut at LOG_CHARS: its leading "ok" still tells the outcome.
				result = {"ok": raw.startswith('{"ok": true')}
			item["ok"] = bool(result.get("ok")) if isinstance(result, dict) else False
			item["summary"] = rules.clip(result.get("error") if isinstance(result, dict) else "", 160)
		messages.append(item)
	draft = cstr(conv.draft_invoice)
	draft_doc = _readable_invoice(draft)
	return {
		"name": conv.name,
		"title": conv.title or "",
		"status": conv.status,
		"draft_invoice": draft if draft_doc is not None else "",
		"draft_url": f"/desk/sale-tax-invoice/{draft}" if draft_doc is not None else "",
		"draft_environment": draft_doc.fbr_environment if draft_doc is not None else "",
		"draft_status": ("Draft" if cint(draft_doc.docstatus) == 0 else "Submitted")
		if draft_doc is not None
		else "",
		"invoice_context": conv.invoice_context or "",
		"model": conv.model or "",
		"messages": messages,
		"usage": {
			"input_tokens": cint(conv.total_input_tokens),
			"output_tokens": cint(conv.total_output_tokens),
		},
	}


def chat(message, conversation=None, invoice=None) -> dict:
	role = check_access()
	settings = get_settings(require_enabled=True)
	api_key = require_api_key(settings)

	message = cstr(message).strip()
	if not message:
		frappe.throw(_("Type a message first."))
	if len(message) > MAX_MESSAGE_CHARS:
		frappe.throw(_("The message is too long (maximum {0} characters).").format(MAX_MESSAGE_CHARS))

	user = frappe.session.user
	ttl = settings.turn_budget_seconds + 30
	unavailable = _(
		"The assistant is temporarily unavailable (cache error, logged for the administrator). Try again in a minute."
	)
	held = acquire_turn_lock(user, ttl)
	if held is None:
		frappe.throw(unavailable, title=_("AI Assistant"))
	if not held:
		frappe.throw(
			_("Your previous message is still being answered. Wait for it to finish."),
			title=_("AI Assistant"),
		)
	slot = False
	try:
		free = acquire_turn_slot(ttl)
		if free is None:
			frappe.throw(unavailable, title=_("AI Assistant"))
		if not free:
			frappe.throw(
				_("The assistant is busy with other users right now. Wait a moment and try again."),
				title=_("AI Assistant"),
			)
		slot = True
		check_daily_cap(settings)
		conv = load_conversation(conversation) if cstr(conversation).strip() else new_conversation(invoice)
		if not conv.title:
			conv.title = rules.clip(message, 70)
		conv.status = "Active"
		conv.append("messages", {"role": "user", "content": message, "created_at": now_datetime()})
		_save(conv)
		frappe.db.commit()

		client = oc.OpenAIClient(api_key)
		settings.counters = {}
		instructions = prompts.build_instructions(
			build_static_context(settings, role), settings.extra_instructions
		)
		turn_context = build_turn_context(settings, conv, role)
		turn = Turn(
			client,
			settings,
			conv,
			instructions,
			turn_context,
			tools.tool_definitions(settings),
			TurnBudget(settings.turn_budget_seconds),
		)
		started = time.monotonic()
		try:
			reply = turn.run(message)
		except oc.OpenAIError as exc:
			_record_failure(conv, turn, exc)
			frappe.throw(user_message(exc), title=_("AI Assistant"))

		for row in turn.rows:
			conv.append("messages", row)
		conv.append(
			"messages",
			{
				"role": "assistant",
				"content": reply,
				"input_tokens": turn.usage.input_tokens,
				"output_tokens": turn.usage.output_tokens,
				"duration_ms": int((time.monotonic() - started) * 1000),
				"created_at": now_datetime(),
			},
		)
		if turn.draft:
			conv.draft_invoice = turn.draft
			conv.seller = (
				frappe.db.get_value(tools.INVOICE_DOCTYPE, turn.draft, "seller__business_name") or conv.seller
			)
		conv.last_response_id = (
			turn.last_response_id if (settings.store_on_openai and not turn.chain_broken) else None
		)
		conv.model = turn.model or conv.model
		conv.total_input_tokens = cint(conv.total_input_tokens) + turn.usage.input_tokens
		conv.total_output_tokens = cint(conv.total_output_tokens) + turn.usage.output_tokens
		conv.last_error = None
		_save(conv)
		frappe.db.commit()
		progress(conv.name, "done", "")
	finally:
		if slot:
			release_turn_slot()
		release_turn_lock(user)

	payload = conversation_payload(conv)
	return {
		"conversation": conv.name,
		"title": conv.title,
		"reply": reply,
		"draft_invoice": payload["draft_invoice"],
		"draft_url": payload["draft_url"],
		"draft_environment": payload["draft_environment"],
		"actions": turn.actions,
		"model": turn.model,
		"remaining_today": remaining_today(settings),
		"usage": {
			"input_tokens": turn.usage.input_tokens,
			"output_tokens": turn.usage.output_tokens,
			"cached_tokens": turn.usage.cached_tokens,
			"reasoning_tokens": turn.usage.reasoning_tokens,
			"model_calls": turn.model_calls,
		},
	}
