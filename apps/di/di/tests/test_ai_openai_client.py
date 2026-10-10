"""The OpenAI client: failure classes, body shape, response parsing. No network."""

import unittest
from unittest.mock import patch

import requests

from di.ai import openai_client as oc


class FakeResponse:
	def __init__(self, status_code=200, body=None, text="", headers=None):
		self.status_code = status_code
		self._body = body
		self.text = text
		self.headers = headers or {}

	def json(self):
		if self._body is None:
			raise ValueError("not json")
		return self._body


class FakeSession:
	def __init__(self, *responses):
		self.responses = list(responses)
		self.calls = []

	def request(self, method, url, json=None, headers=None, timeout=None):
		self.calls.append(
			{"method": method, "url": url, "json": json, "headers": headers, "timeout": timeout}
		)
		item = self.responses.pop(0)
		if isinstance(item, Exception):
			raise item
		return item


def client(*responses):
	session = FakeSession(*responses)
	return oc.OpenAIClient("sk-test-1234567890", session=session), session


def limited(retry_after=None):
	headers = {"Retry-After": str(retry_after)} if retry_after is not None else None
	return FakeResponse(
		429, {"error": {"message": "slow down", "code": "rate_limit_exceeded"}}, headers=headers
	)


class TestFailureClasses(unittest.TestCase):
	def test_missing_key_is_an_auth_error_before_any_call(self):
		with self.assertRaises(oc.OpenAIAuthError):
			oc.OpenAIClient("")

	def test_401_is_auth(self):
		c, _s = client(
			FakeResponse(401, {"error": {"message": "Incorrect API key", "code": "invalid_api_key"}})
		)
		with self.assertRaises(oc.OpenAIAuthError):
			c.list_models()

	def test_404_model_not_found(self):
		c, _s = client(
			FakeResponse(
				404, {"error": {"message": "The model `x` does not exist", "code": "model_not_found"}}
			)
		)
		with self.assertRaises(oc.OpenAIModelNotFound):
			c.create_response(model="x", input=[])

	def test_403_model_not_found_is_a_fallback_case_not_a_bad_key(self):
		# A project barred from a model (project model limits) answers 403 with this code.
		body = {
			"error": {
				"message": "Project does not have access to model gpt-6-astra",
				"code": "model_not_found",
			}
		}
		c, _s = client(FakeResponse(403, body))
		with self.assertRaises(oc.OpenAIModelNotFound):
			c.create_response(model="gpt-6-astra", input=[])

	def test_403_without_a_model_code_is_auth(self):
		body = {
			"error": {
				"message": "Country, region, or territory not supported",
				"code": "unsupported_country_region_territory",
			}
		}
		c, _s = client(FakeResponse(403, body))
		with self.assertRaises(oc.OpenAIAuthError):
			c.create_response(model="m", input=[])

	def test_429_is_retried_once_then_rate_limited(self):
		c, s = client(limited(1), limited())
		with (
			patch.object(oc.time, "sleep", return_value=None),
			self.assertRaises(oc.OpenAIRateLimited) as ctx,
		):
			c.create_response(model="m", input=[])
		self.assertEqual(len(s.calls), 2)
		self.assertFalse(ctx.exception.quota)

	def test_429_quota_is_not_retried(self):
		c, s = client(
			FakeResponse(
				429, {"error": {"message": "You exceeded your current quota", "code": "insufficient_quota"}}
			)
		)
		with (
			patch.object(oc.time, "sleep", return_value=None),
			self.assertRaises(oc.OpenAIRateLimited) as ctx,
		):
			c.create_response(model="m", input=[])
		self.assertEqual(len(s.calls), 1)
		self.assertTrue(ctx.exception.quota)

	def test_429_recovers_when_the_retry_succeeds(self):
		c, s = client(limited(), FakeResponse(200, {"id": "resp_ok", "output": []}))
		with patch.object(oc.time, "sleep", return_value=None):
			self.assertEqual(c.create_response(model="m", input=[])["id"], "resp_ok")
		self.assertEqual(len(s.calls), 2)

	def test_retry_after_beyond_what_the_turn_can_wait_is_not_retried(self):
		c, s = client(limited(100), FakeResponse(200, {"id": "never", "output": []}))
		with patch.object(oc.time, "sleep") as sleep, self.assertRaises(oc.OpenAIRateLimited) as ctx:
			c.create_response(model="m", input=[])
		self.assertEqual(len(s.calls), 1)
		sleep.assert_not_called()
		self.assertEqual(ctx.exception.retry_after, 100.0)

	def test_retry_pause_follows_the_header_within_the_cap_and_the_budget(self):
		c, _s = client(limited(2), FakeResponse(200, {"id": "r", "output": []}))
		with patch.object(oc.time, "sleep") as sleep:
			c.create_response(model="m", input=[], retry_budget=30)
		sleep.assert_called_once_with(2.0)
		# No header: wait the smaller of the cap and what the caller can afford.
		c, _s = client(FakeResponse(503, text="busy"), FakeResponse(200, {"id": "r", "output": []}))
		with patch.object(oc.time, "sleep") as sleep:
			c.create_response(model="m", input=[], retry_budget=2.5)
		sleep.assert_called_once_with(2.5)

	def test_no_retry_budget_means_no_retry(self):
		c, s = client(limited())
		with patch.object(oc.time, "sleep", return_value=None), self.assertRaises(oc.OpenAIRateLimited):
			c.create_response(model="m", input=[], retry_budget=0)
		self.assertEqual(len(s.calls), 1)

	def test_5xx_and_read_timeout_are_unavailable(self):
		c, s = client(FakeResponse(503, text="busy"), FakeResponse(503, text="busy"))
		with patch.object(oc.time, "sleep", return_value=None), self.assertRaises(oc.OpenAIUnavailable):
			c.create_response(model="m", input=[])
		self.assertEqual(len(s.calls), 2, "a 503 is retried once")
		c, _s = client(requests.ReadTimeout("read timed out"))
		with self.assertRaises(oc.OpenAIUnavailable):
			c.create_response(model="m", input=[])

	def test_connection_failure_is_retried_once_then_unavailable(self):
		c, s = client(requests.ConnectionError("refused"), requests.ConnectionError("refused"))
		with patch.object(oc.time, "sleep", return_value=None), self.assertRaises(oc.OpenAIUnavailable):
			c.create_response(model="m", input=[])
		self.assertEqual(len(s.calls), 2)

	def test_other_400_is_bad_request_with_code(self):
		c, _s = client(
			FakeResponse(
				400,
				{"error": {"message": "Previous response not found", "code": "previous_response_not_found"}},
			)
		)
		with self.assertRaises(oc.OpenAIBadRequest) as ctx:
			c.create_response(model="m", input=[])
		self.assertEqual(ctx.exception.code, "previous_response_not_found")
		self.assertTrue(oc.is_previous_response_error(ctx.exception))
		self.assertFalse(oc.is_context_length_error(ctx.exception))
		self.assertTrue(
			oc.is_context_length_error(
				oc.OpenAIBadRequest(
					"maximum context length exceeded", status=400, code="context_length_exceeded"
				)
			)
		)

	def test_404_about_a_previous_response_is_not_a_model_error(self):
		c, _s = client(
			FakeResponse(
				404,
				{
					"error": {
						"message": "Previous response with id 'resp_x' not found",
						"code": "previous_response_not_found",
					}
				},
			)
		)
		with self.assertRaises(oc.OpenAIBadRequest) as ctx:
			c.create_response(model="m", input=[])
		self.assertTrue(oc.is_previous_response_error(ctx.exception))

	def test_errors_never_carry_the_key(self):
		c, _s = client(FakeResponse(400, {"error": {"message": "bad key sk-proj-abcdefghijklmnop used"}}))
		with self.assertRaises(oc.OpenAIBadRequest) as ctx:
			c.create_response(model="m", input=[])
		self.assertNotIn("sk-proj-abcdefghijklmnop", str(ctx.exception))
		self.assertIn("sk-***", str(ctx.exception))

	def test_the_retry_cannot_outlive_the_budget(self):
		c, s = client(FakeResponse(503, text="busy"), FakeResponse(200, {"id": "r", "output": []}))
		with patch.object(oc.time, "sleep") as sleep:
			c.create_response(model="m", input=[], retry_budget=30)
		sleep.assert_called_once_with(15.0)
		self.assertEqual(s.calls[0]["timeout"], (oc.CONNECT_TIMEOUT, oc.READ_TIMEOUT))
		# 30 s budget, 15 s slept: the second attempt may read for 15 s at most.
		self.assertEqual(s.calls[1]["timeout"], (oc.CONNECT_TIMEOUT, 15.0))


class TestRequestShape(unittest.TestCase):
	def test_create_response_body(self):
		c, s = client(FakeResponse(200, {"id": "resp_1", "output": []}))
		tools = [
			{
				"type": "function",
				"name": "t",
				"parameters": {"type": "object", "properties": {}},
				"strict": True,
			}
		]
		c.create_response(
			model="gpt-6-astra",
			input=[{"role": "user", "content": "hi"}],
			instructions="be brief",
			tools=tools,
			previous_response_id="resp_0",
			reasoning_effort="medium",
			max_output_tokens=500,
			store=True,
			prompt_cache_key="di-ai-clerk@example.com",
		)
		body = s.calls[0]["json"]
		self.assertEqual(body["prompt_cache_key"], "di-ai-clerk@example.com")
		self.assertEqual(body["model"], "gpt-6-astra")
		self.assertEqual(body["instructions"], "be brief")
		self.assertEqual(body["tools"], tools)
		self.assertEqual(body["tool_choice"], "auto")
		self.assertTrue(body["parallel_tool_calls"])
		self.assertEqual(body["previous_response_id"], "resp_0")
		self.assertEqual(body["reasoning"], {"effort": "medium"})
		self.assertEqual(body["max_output_tokens"], 500)
		self.assertTrue(body["store"])
		self.assertEqual(s.calls[0]["headers"]["Authorization"], "Bearer sk-test-1234567890")
		self.assertTrue(s.calls[0]["url"].endswith("/responses"))

	def test_no_tools_means_no_tool_choice(self):
		c, s = client(FakeResponse(200, {"id": "resp_1", "output": []}))
		c.create_response(model="m", input=[], reasoning_effort=None)
		body = s.calls[0]["json"]
		self.assertNotIn("tools", body)
		self.assertNotIn("tool_choice", body)
		self.assertNotIn("reasoning", body)

	def test_prompt_cache_key_is_cut_to_the_api_limit(self):
		c, s = client(FakeResponse(200, {"id": "resp_1", "output": []}))
		c.create_response(model="m", input=[], prompt_cache_key="x" * 100)
		self.assertEqual(len(s.calls[0]["json"]["prompt_cache_key"]), 64)

	def test_list_models_returns_sorted_ids(self):
		c, _s = client(FakeResponse(200, {"data": [{"id": "gpt-b"}, {"id": "gpt-a"}]}))
		self.assertEqual(c.list_models(), ["gpt-a", "gpt-b"])

	def test_stateless_requests_ask_for_encrypted_reasoning(self):
		c, s = client(
			FakeResponse(200, {"id": "r", "output": []}), FakeResponse(200, {"id": "r", "output": []})
		)
		c.create_response(model="m", input=[], store=False)
		self.assertEqual(s.calls[0]["json"]["include"], ["reasoning.encrypted_content"])
		c.create_response(model="m", input=[], store=True)
		self.assertNotIn("include", s.calls[1]["json"])


RESPONSE = {
	"id": "resp_9",
	"status": "completed",
	"output": [
		{"type": "reasoning", "summary": []},
		{
			"type": "function_call",
			"id": "fc_1",
			"call_id": "call_1",
			"name": "search_buyers",
			"arguments": '{"seller": "A", "query": "uni"}',
		},
		{
			"type": "message",
			"role": "assistant",
			"content": [{"type": "output_text", "text": "Draft STI-0332 ready."}],
		},
	],
	"usage": {"input_tokens": 1200, "output_tokens": 80, "input_tokens_details": {"cached_tokens": 1000}},
}


class TestResponseParsing(unittest.TestCase):
	def test_function_calls_and_text(self):
		calls = oc.function_calls(RESPONSE)
		self.assertEqual(
			calls,
			[
				{
					"call_id": "call_1",
					"name": "search_buyers",
					"arguments": '{"seller": "A", "query": "uni"}',
					"incomplete": False,
				}
			],
		)
		self.assertEqual(oc.output_text(RESPONSE), "Draft STI-0332 ready.")
		self.assertEqual(oc.parse_arguments(calls[0]["arguments"]), {"seller": "A", "query": "uni"})
		self.assertEqual(oc.parse_arguments("not json"), {})

	def test_a_cut_off_call_is_flagged(self):
		response = {
			"status": "incomplete",
			"incomplete_details": {"reason": "max_output_tokens"},
			"output": [
				{
					"type": "function_call",
					"call_id": "c1",
					"name": "create_draft_invoice",
					"arguments": '{"seller": "Ac',
					"status": "incomplete",
				}
			],
		}
		calls = oc.function_calls(response)
		self.assertTrue(calls[0]["incomplete"])
		self.assertEqual(oc.parse_arguments(calls[0]["arguments"]), {})

	def test_a_refusal_is_visible_text(self):
		response = {
			"output": [
				{"type": "message", "content": [{"type": "refusal", "refusal": "I cannot help with that."}]}
			]
		}
		self.assertEqual(oc.output_text(response), "I cannot help with that.")

	def test_usage_and_incomplete(self):
		used = oc.usage(RESPONSE)
		self.assertEqual(
			(used.input_tokens, used.output_tokens, used.cached_tokens, used.total_tokens),
			(1200, 80, 1000, 1280),
		)
		self.assertIsNone(oc.incomplete_reason(RESPONSE))
		self.assertEqual(
			oc.incomplete_reason(
				{"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}}
			),
			"max_output_tokens",
		)
		self.assertIsNone(oc.failure(RESPONSE))
		self.assertEqual(
			oc.failure({"status": "failed", "error": {"code": "server_error", "message": "boom"}}),
			"server_error: boom",
		)
		self.assertEqual(
			oc.usage({"usage": {"output_tokens_details": {"reasoning_tokens": 7}}}).reasoning_tokens, 7
		)

	def test_function_call_output_item(self):
		item = oc.function_call_output("call_1", {"ok": True, "rows": []})
		self.assertEqual(item["type"], "function_call_output")
		self.assertEqual(item["call_id"], "call_1")
		self.assertIn('"ok": true', item["output"])

	def test_replayable_output_keeps_reasoning_content_and_drops_dangling_items(self):
		output = [
			{"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "enc"},
			{
				"type": "message",
				"id": "msg_1",
				"status": "completed",
				"role": "assistant",
				"content": [{"type": "output_text", "text": "hi"}],
			},
			{
				"type": "function_call",
				"id": "fc_1",
				"status": "completed",
				"call_id": "c1",
				"name": "t",
				"arguments": "{}",
			},
			{"type": "reasoning", "id": "rs_2", "summary": []},
			{
				"type": "function_call",
				"id": "fc_2",
				"call_id": "c2",
				"name": "t",
				"arguments": '{"a',
				"status": "incomplete",
			},
		]
		items = oc.replayable_output(output)
		self.assertEqual([item["type"] for item in items], ["reasoning", "message", "function_call"])
		self.assertEqual(items[0], output[0])
		self.assertNotIn("id", items[1])
		self.assertNotIn("status", items[2])
		self.assertEqual(items[2]["call_id"], "c1")
		self.assertEqual(oc.replayable_output(None), [])

	def test_scrub(self):
		self.assertEqual(oc.scrub("key sk-proj-ABCDEFGHIJ123 here"), "key sk-*** here")
		self.assertEqual(oc.scrub(None), "")
