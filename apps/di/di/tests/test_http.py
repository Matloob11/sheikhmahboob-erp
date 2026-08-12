"""How an FBR call fails decides whether it may be sent again.

These are the tests that matter most in this app. Getting the classification
wrong means either abandoning an invoice that was never filed, or filing the
same sale with FBR twice — and an FBR submission cannot be withdrawn.
"""

import unittest
from unittest.mock import patch

import requests

from di.integrations import http


class FakeResponse:
	def __init__(self, status_code=200, body=None, text=""):
		self.status_code = status_code
		self._body = body
		self.text = text

	def json(self):
		if self._body is None:
			raise ValueError("not json")
		return self._body


class TestFBRErrorClassification(unittest.TestCase):
	def _call(self, **kwargs):
		with patch.object(http.time, "sleep", return_value=None):
			with patch.object(http.requests, "request", **kwargs) as call:
				try:
					result = http.post("https://example.invalid", "token", {}, "test")
				except Exception as exc:
					# Returned rather than raised: the exception type is what
					# each test asserts on.
					return exc, call
				return result, call

	@staticmethod
	def _refused():
		"""A connection that was never established, shaped the way urllib3 nests it."""
		inner = type("NewConnectionError", (OSError,), {})("connection refused")
		return requests.ConnectionError(inner)

	@staticmethod
	def _aborted_midflight():
		"""FBR read the request, then dropped the connection before answering."""
		inner = type("ProtocolError", (OSError,), {})(
			"Connection aborted: Remote end closed connection without response"
		)
		return requests.ConnectionError(inner)

	def test_refused_connection_is_unsent_and_retried(self):
		"""Nothing reached FBR, so sending it again is safe."""
		error, call = self._call(side_effect=self._refused())
		self.assertIsInstance(error, http.FBRUnsentError)
		self.assertEqual(call.call_count, http.CONNECT_ATTEMPTS)

	def test_connection_aborted_after_sending_is_uncertain(self):
		"""The request was delivered. Resending it would file the invoice twice."""
		error, call = self._call(side_effect=self._aborted_midflight())
		self.assertIsInstance(error, http.FBRUncertainError)
		self.assertEqual(call.call_count, 1, "a mid-flight abort must not be retried")

	def test_connect_timeout_is_unsent(self):
		"""The socket was never established, so nothing was filed."""
		error, _call = self._call(side_effect=requests.ConnectTimeout("connect timed out"))
		self.assertIsInstance(error, http.FBRUnsentError)

	def test_client_errors_are_rejections_not_data(self):
		"""A 404 body used to be parsed as though it were a normal answer."""
		for status in (400, 404, 422):
			error, _call = self._call(return_value=FakeResponse(status, text="nope"))
			self.assertIsInstance(error, http.FBRRejected, f"status {status}")

	def test_read_timeout_is_uncertain_and_never_retried(self):
		"""The request left. FBR may hold the invoice, so this must not resend."""
		error, call = self._call(side_effect=requests.Timeout("read timed out"))
		self.assertIsInstance(error, http.FBRUncertainError)
		self.assertEqual(call.call_count, 1, "a read timeout must not be retried")

	def test_server_error_is_uncertain(self):
		error, _call = self._call(return_value=FakeResponse(503, text="busy"))
		self.assertIsInstance(error, http.FBRUncertainError)

	def test_unauthorized_is_a_rejection(self):
		"""A bad token is deterministic; resending the same payload changes nothing."""
		error, _call = self._call(return_value=FakeResponse(401, text="nope"))
		self.assertIsInstance(error, http.FBRRejected)

	def test_unsent_and_uncertain_never_collapse(self):
		"""The whole retry decision rests on these two staying distinct."""
		self.assertFalse(issubclass(http.FBRUnsentError, http.FBRUncertainError))
		self.assertFalse(issubclass(http.FBRUncertainError, http.FBRUnsentError))

	def test_trailing_comma_json_is_salvaged(self):
		"""FBR sometimes answers with trailing commas, which strict JSON rejects."""
		result, _call = self._call(return_value=FakeResponse(200, text='{"invoiceNumber": "X",}'))
		self.assertEqual(result, {"invoiceNumber": "X"})

	def test_unreadable_body_is_uncertain_not_success(self):
		"""An HTML error page must not be mistaken for a successful filing."""
		error, _call = self._call(return_value=FakeResponse(200, text="<html>gateway</html>"))
		self.assertIsInstance(error, http.FBRUncertainError)

	def test_success_returns_the_body(self):
		result, _call = self._call(return_value=FakeResponse(200, body={"invoiceNumber": "ABC"}))
		self.assertEqual(result, {"invoiceNumber": "ABC"})
