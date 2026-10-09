"""The OpenAI Responses API over `requests`.

No SDK: the bench would need `bench setup requirements` for one, and the
assistant uses a handful of calls. What this module does know is how a call
fails, because that decides what the assistant may do next:

    OpenAIAuthError      the key is missing, wrong or revoked (401, or a 403 that
                         is not about a model): configuration.
    OpenAIModelNotFound  this key or project cannot use the model (403/404 with
                         code model_not_found): try the next fallback.
    OpenAIRateLimited    429: tell the user to retry in a moment.
    OpenAIUnavailable    5xx, connection failure, read timeout: not our fault.
    OpenAIBadRequest     anything else 4xx, including an expired
                         previous_response_id: the caller decides.

The API key never appears in an exception, a log line or a result: every
message that could carry it is scrubbed first.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass

import requests

DEFAULT_BASE_URL = "https://api.openai.com/v1"
CONNECT_TIMEOUT = 10
READ_TIMEOUT = 60
CONNECT_ATTEMPTS = 2
CONNECT_BACKOFF_SECONDS = 1.0
# A temporary 429/5xx is retried once after at most this many seconds (and never
# longer than the caller can afford).
RETRY_AFTER_CAP_SECONDS = 15
# These 429s need a human (billing, quota); retrying only wastes the turn.
_QUOTA_CODES = ("insufficient_quota", "billing", "credit_balance", "spend_limit", "usage_limit")

_SECRET = re.compile(r"sk-[A-Za-z0-9_\-]{8,}")


def scrub(text) -> str:
	return _SECRET.sub("sk-***", str(text if text is not None else ""))


class OpenAIError(Exception):
	def __init__(self, message, *, status=None, code=None):
		super().__init__(scrub(message))
		self.status = status
		self.code = code or ""


class OpenAIAuthError(OpenAIError):
	"""401, a 403 that is not about a model, or no key configured."""


class OpenAIModelNotFound(OpenAIError):
	"""The key or project cannot use this model (403/404 model_not_found)."""


class OpenAIRateLimited(OpenAIError):
	"""429."""

	def __init__(self, message, *, status=None, code=None, retry_after=None, quota=False):
		super().__init__(message, status=status, code=code)
		self.retry_after = retry_after
		self.quota = quota


class OpenAIUnavailable(OpenAIError):
	"""5xx, connection failure, or no answer in time."""


class OpenAIBadRequest(OpenAIError):
	"""Any other 4xx."""


@dataclass
class Usage:
	input_tokens: int = 0
	output_tokens: int = 0
	cached_tokens: int = 0
	reasoning_tokens: int = 0

	@property
	def total_tokens(self) -> int:
		return self.input_tokens + self.output_tokens


class OpenAIClient:
	def __init__(self, api_key, *, base_url=DEFAULT_BASE_URL, timeout=None, session=None):
		if not (api_key or "").strip():
			raise OpenAIAuthError("OpenAI API key is not configured.", status=401, code="missing_api_key")
		self._api_key = api_key.strip()
		self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
		self.timeout = timeout or (CONNECT_TIMEOUT, READ_TIMEOUT)
		self._session = session or requests.Session()

	def _headers(self):
		return {
			"Authorization": f"Bearer {self._api_key}",
			"Content-Type": "application/json",
			"Accept": "application/json",
		}

	def _request(self, method, path, body=None, *, timeout=None, retry_budget=None):
		url = f"{self.base_url}{path}"
		wait = timeout or self.timeout
		retried_after_limit = False
		while True:
			response = None
			for attempt in range(CONNECT_ATTEMPTS):
				try:
					response = self._session.request(
						method, url, json=body, headers=self._headers(), timeout=wait
					)
					break
				except requests.ConnectionError as exc:
					# A model call has no side effect we care about, so a connection
					# that never settled may simply be tried again.
					if attempt + 1 < CONNECT_ATTEMPTS:
						time.sleep(CONNECT_BACKOFF_SECONDS)
						continue
					raise OpenAIUnavailable(f"Could not reach OpenAI: {exc}")
				except requests.Timeout as exc:
					raise OpenAIUnavailable(f"OpenAI did not answer in time: {exc}")
				except requests.RequestException as exc:
					raise OpenAIUnavailable(f"Request to OpenAI failed: {exc}")
			try:
				return self._handle(response)
			except (OpenAIRateLimited, OpenAIUnavailable) as exc:
				# One short wait for a temporary limit or an overloaded server,
				# bounded by what the caller can still afford.
				retry_after = getattr(exc, "retry_after", None)
				quota = getattr(exc, "quota", False)
				can_wait = retry_budget if retry_budget is not None else RETRY_AFTER_CAP_SECONDS
				if retried_after_limit or quota or exc.status is None or can_wait < 1:
					raise
				longest = min(float(RETRY_AFTER_CAP_SECONDS), float(can_wait))
				if retry_after and float(retry_after) > longest:
					# OpenAI asked for a longer pause than this turn can afford; an early
					# retry is a near-certain second 429, so the caller gets the answer now.
					raise
				pause = float(retry_after) if retry_after else longest
				time.sleep(pause)
				retried_after_limit = True
				# The second attempt may not outlive what the caller can afford either.
				connect, read = wait if isinstance(wait, tuple) else (CONNECT_TIMEOUT, wait)
				wait = (connect, max(5.0, min(float(read), float(can_wait) - pause)))

	@staticmethod
	def _handle(response):
		status = response.status_code
		try:
			body = response.json()
		except ValueError:
			body = {"error": {"message": (response.text or "")[:500]}}
		if 200 <= status < 300:
			return body if isinstance(body, dict) else {"data": body}

		error = body.get("error") if isinstance(body, dict) else None
		error = error if isinstance(error, dict) else {}
		code = str(error.get("code") or error.get("type") or "")
		message = str(error.get("message") or (response.text or "")[:300] or f"HTTP {status}")
		text = f"OpenAI {status} {code}: {message}".strip()

		lowered = message.lower()
		# A project barred from a model answers 403 with code model_not_found: that is a
		# fallback case, not a bad key, so the code is tested before the status.
		if code == "model_not_found" or (status == 404 and "model" in lowered and "previous" not in lowered):
			raise OpenAIModelNotFound(text, status=status, code=code or "model_not_found")
		if status in (401, 403):
			raise OpenAIAuthError(text, status=status, code=code or "unauthorized")
		if status == 429:
			headers = getattr(response, "headers", None) or {}
			try:
				retry_after = float(headers.get("Retry-After") or 0) or None
			except (TypeError, ValueError):
				retry_after = None
			quota = any(marker in (code + " " + message).lower() for marker in _QUOTA_CODES)
			raise OpenAIRateLimited(
				text, status=status, code=code or "rate_limited", retry_after=retry_after, quota=quota
			)
		if status >= 500:
			raise OpenAIUnavailable(text, status=status, code=code or "server_error")
		raise OpenAIBadRequest(text, status=status, code=code)

	def list_models(self) -> list[str]:
		body = self._request("GET", "/models", timeout=(CONNECT_TIMEOUT, 30))
		return sorted(str(row.get("id")) for row in body.get("data") or [] if row.get("id"))

	def create_response(
		self,
		*,
		model,
		input,
		instructions=None,
		tools=None,
		tool_choice="auto",
		previous_response_id=None,
		reasoning_effort=None,
		max_output_tokens=None,
		store=True,
		parallel_tool_calls=True,
		metadata=None,
		prompt_cache_key=None,
		timeout=None,
		retry_budget=None,
	) -> dict:
		body = {"model": model, "input": input, "store": bool(store)}
		if not store:
			# Nothing is kept server-side, so reasoning items can only be replayed when
			# they carry their encrypted content.
			body["include"] = ["reasoning.encrypted_content"]
		if instructions:
			body["instructions"] = instructions
		if tools:
			body["tools"] = tools
			body["tool_choice"] = tool_choice
			body["parallel_tool_calls"] = bool(parallel_tool_calls)
		if previous_response_id:
			body["previous_response_id"] = previous_response_id
		if reasoning_effort:
			body["reasoning"] = {"effort": reasoning_effort}
		if max_output_tokens:
			body["max_output_tokens"] = int(max_output_tokens)
		if metadata:
			body["metadata"] = metadata
		if prompt_cache_key:
			body["prompt_cache_key"] = str(prompt_cache_key)[:64]
		return self._request("POST", "/responses", body, timeout=timeout, retry_budget=retry_budget)


def function_calls(response) -> list[dict]:
	"""The tool calls the model asked for, in order.

	A call cut off by max_output_tokens arrives with status "incomplete" and
	truncated JSON; it is flagged so the caller never runs it with empty arguments.
	"""
	calls = []
	for item in (response or {}).get("output") or []:
		if item.get("type") == "function_call":
			calls.append(
				{
					"call_id": item.get("call_id") or item.get("id") or "",
					"name": item.get("name") or "",
					"arguments": item.get("arguments") or "{}",
					"incomplete": item.get("status") == "incomplete",
				}
			)
	return calls


def replayable_output(output) -> list[dict]:
	"""The model's own output items as they may be sent back in stateless mode.

	A cut-off function_call cannot be replayed (its arguments are not JSON), and a
	reasoning item is only accepted together with the item it led to, so a reasoning
	item left at the tail goes too. Reasoning items keep their encrypted content; the
	server-side ids of message and function_call items are dropped because nothing is
	stored that could resolve them.
	"""
	items = []
	for item in output or []:
		kind = item.get("type")
		if kind == "function_call" and item.get("status") == "incomplete":
			continue
		if kind in ("message", "function_call"):
			item = {key: value for key, value in item.items() if key not in ("id", "status")}
		items.append(item)
	while items and items[-1].get("type") == "reasoning":
		items.pop()
	return items


def output_text(response) -> str:
	"""The visible reply: output_text parts, and a refusal when that is all the model said."""
	parts = []
	for item in (response or {}).get("output") or []:
		if item.get("type") != "message":
			continue
		for content in item.get("content") or []:
			if content.get("type") == "output_text" and content.get("text"):
				parts.append(content["text"])
			elif content.get("type") == "refusal" and content.get("refusal"):
				parts.append(content["refusal"])
	if not parts and (response or {}).get("output_text"):
		parts.append(response["output_text"])
	return "\n".join(parts).strip()


def incomplete_reason(response) -> str | None:
	if (response or {}).get("status") != "incomplete":
		return None
	details = response.get("incomplete_details") or {}
	return details.get("reason") or "incomplete"


def failure(response) -> str | None:
	"""The error text of a response whose status is failed, else None."""
	if (response or {}).get("status") != "failed":
		return None
	error = response.get("error") or {}
	if isinstance(error, dict):
		return scrub(f"{error.get('code') or 'failed'}: {error.get('message') or ''}".strip())
	return scrub(str(error) or "failed")


def usage(response) -> Usage:
	raw = (response or {}).get("usage") or {}
	details = raw.get("input_tokens_details") or {}
	output_details = raw.get("output_tokens_details") or {}
	return Usage(
		input_tokens=int(raw.get("input_tokens") or 0),
		output_tokens=int(raw.get("output_tokens") or 0),
		cached_tokens=int(details.get("cached_tokens") or 0),
		reasoning_tokens=int(output_details.get("reasoning_tokens") or 0),
	)


def parse_arguments(raw) -> dict:
	"""Tool arguments arrive as a JSON string; a malformed one becomes {}."""
	if isinstance(raw, dict):
		return raw
	try:
		value = json.loads(raw or "{}")
	except (TypeError, ValueError):
		return {}
	return value if isinstance(value, dict) else {}


def function_call_output(call_id, output) -> dict:
	text = output if isinstance(output, str) else json.dumps(output, default=str, ensure_ascii=False)
	return {"type": "function_call_output", "call_id": call_id, "output": text}


def is_previous_response_error(exc) -> bool:
	"""An expired or unknown previous_response_id: rebuild from history and retry."""
	if not isinstance(exc, (OpenAIBadRequest, OpenAIModelNotFound)):
		return False
	if getattr(exc, "code", "") == "previous_response_not_found":
		return True
	text = str(exc).lower()
	return "previous_response" in text or "previous response" in text


def is_context_length_error(exc) -> bool:
	"""The chain outgrew the model's window: start a fresh one from local history."""
	if not isinstance(exc, OpenAIBadRequest):
		return False
	text = (str(exc) + " " + getattr(exc, "code", "")).lower()
	return "context_length" in text or "maximum context" in text or "too many tokens" in text
