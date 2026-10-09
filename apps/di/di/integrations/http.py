"""One place to talk to FBR.

Every call used to be hand-rolled: five call sites, five copies of the headers,
five timeouts, no shared error handling and no retry. More importantly nothing
distinguished *how* a call failed, and that distinction decides whether a
submission may be sent again.

    FBRUnsentError    the request never reached FBR (DNS, refused connection).
                      Nothing was filed, so sending it again is safe.

    FBRUncertainError the request went out and we did not get a usable answer
                      (read timeout, 5xx). FBR may have recorded the invoice.
                      Sending it again risks a second filing against a real tax
                      identity, which cannot be withdrawn — so we never do it
                      automatically.

    FBRRejected       FBR answered and refused. The same payload will be refused
                      again, so there is nothing to retry; it needs an edit.

Connection failures are retried here, immediately and briefly, because they are
provably safe. Read timeouts are not retried at any level.
"""

import json
import re
import time

import frappe
import requests
from frappe import _

CONNECT_TIMEOUT = 10
READ_TIMEOUT = 30

# Only connection failures are retried, and only a couple of times: this is for
# a blip in the path to FBR, not for FBR being unwell.
CONNECT_ATTEMPTS = 3
CONNECT_BACKOFF_SECONDS = 1.5

# FBR occasionally answers with trailing commas, which strict JSON rejects.
_TRAILING_COMMA = re.compile(r",\s*([}\]])")


class FBRError(frappe.ValidationError):
	"""Base for anything that went wrong talking to FBR."""


class FBRUnsentError(FBRError):
	"""The request never reached FBR. Safe to send again."""


class FBRUncertainError(FBRError):
	"""The request reached FBR but the outcome is unknown. Never resend automatically."""


class FBRRejected(FBRError):
	"""FBR answered and refused. Resending the same payload changes nothing."""


def _headers(token, extra=None):
	headers = {
		"Authorization": f"Bearer {token}",
		"Content-Type": "application/json",
		"Accept": "application/json",
	}
	if extra:
		headers.update(extra)
	return headers


def _parse(response, context):
	try:
		return response.json()
	except ValueError:
		text = response.text or ""
		try:
			return json.loads(_TRAILING_COMMA.sub(r"\1", text))
		except ValueError:
			raise FBRUncertainError(
				_("FBR returned a response for {0} that could not be read: {1}").format(
					context, text[:300]
				)
			)


def _check_status(response, context):
	if response.status_code == 401:
		raise FBRRejected(
			_("FBR refused the request for {0}: 401 Unauthorized. Check the access token.").format(
				context
			)
		)
	if response.status_code == 403:
		raise FBRRejected(_("FBR refused the request for {0}: 403 Forbidden.").format(context))
	if response.status_code >= 500:
		# FBR may or may not have acted on it. Treat as unknown, never as a
		# reason to resend.
		raise FBRUncertainError(
			_("FBR returned {0} for {1}. Whether it was recorded is unknown.").format(
				response.status_code, context
			)
		)
	if response.status_code >= 400:
		# Every other 4xx is a refusal too. Letting them through meant a 404 or a
		# 400 was parsed as though it were a normal answer, so a reference sync
		# would quietly process an error body as data.
		raise FBRRejected(
			_("FBR refused the request for {0}: {1} {2}").format(
				context, response.status_code, (response.text or "")[:200]
			)
		)


# Failures raised while the socket is still being established. Anything else —
# an aborted connection, a reset partway through — may have reached FBR after it
# had already read the request.
_CONNECT_PHASE_FAILURES = frozenset(
	{
		"ConnectTimeoutError",
		"NewConnectionError",
		"NameResolutionError",
		"gaierror",
	}
)


def _never_sent(exc):
	"""True only when the request provably never reached FBR.

	requests.ConnectionError is not that guarantee. It also wraps ProtocolError
	— "Remote end closed connection without response" — which happens when the
	server read the request, acted on it, and dropped the connection before
	answering. Retrying that files the invoice a second time, which is the exact
	failure this module exists to prevent, so the check has to look at what
	actually went wrong rather than at the outermost class.
	"""
	if isinstance(exc, requests.exceptions.ConnectTimeout):
		return True

	seen = []
	queue = [exc]
	while queue and len(seen) < 12:
		current = queue.pop()
		if current is None or id(current) in [id(s) for s in seen]:
			continue
		seen.append(current)

		if type(current).__name__ in _CONNECT_PHASE_FAILURES:
			return True

		queue.append(getattr(current, "__cause__", None))
		queue.append(getattr(current, "__context__", None))
		# urllib3 nests the real failure inside args rather than the cause chain.
		for arg in getattr(current, "args", ()) or ():
			if isinstance(arg, BaseException):
				queue.append(arg)

	return False


def request(method, url, token, context, json_body=None, params=None, extra_headers=None, *, timeout=None):
	"""Call FBR and return the decoded body, or raise one of the errors above.

	`timeout` is (connect seconds, read seconds). Callers that are only
	looking something up — a scenario list, a rate table — pass a short one.
	A hung lookup used to sit inside the desk request until nginx cut it at
	120 seconds and the screen showed "Request Timed Out".
	"""
	wait = timeout or (CONNECT_TIMEOUT, READ_TIMEOUT)
	for attempt in range(CONNECT_ATTEMPTS):
		try:
			response = requests.request(
				method,
				url,
				json=json_body,
				params=params,
				headers=_headers(token, extra_headers),
				timeout=wait,
			)
			break
		except requests.Timeout as exc:
			# A connect timeout never established the socket, so nothing was
			# sent. A read timeout means the request left and FBR may have
			# processed it.
			if _never_sent(exc) and attempt + 1 < CONNECT_ATTEMPTS:
				time.sleep(CONNECT_BACKOFF_SECONDS * (attempt + 1))
				continue
			if _never_sent(exc):
				raise FBRUnsentError(
					_("Could not open a connection to FBR for {0}: {1}").format(
						context, str(exc)[:200]
					)
				)
			raise FBRUncertainError(
				_(
					"FBR did not answer in time for {0}. It may have been recorded — check with FBR "
					"before sending it again. ({1})"
				).format(context, str(exc)[:200])
			)
		except requests.RequestException as exc:
			if _never_sent(exc):
				if attempt + 1 < CONNECT_ATTEMPTS:
					time.sleep(CONNECT_BACKOFF_SECONDS * (attempt + 1))
					continue
				raise FBRUnsentError(
					_("Could not reach FBR for {0}: {1}").format(context, str(exc)[:200])
				)
			raise FBRUncertainError(
				_(
					"The connection to FBR broke during {0}, after the request had been sent. It may "
					"have been recorded — check before sending it again. ({1})"
				).format(context, str(exc)[:200])
			)

	_check_status(response, context)
	return _parse(response, context)


def post(url, token, payload, context, extra_headers=None, *, timeout=None):
	return request(
		"POST", url, token, context, json_body=payload, extra_headers=extra_headers, timeout=timeout
	)


def get(url, token, context, params=None, *, timeout=None):
	return request("GET", url, token, context, params=params, timeout=timeout)
