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


def request(method, url, token, context, json_body=None, params=None, extra_headers=None):
	"""Call FBR and return the decoded body, or raise one of the errors above."""
	last_connection_error = None

	for attempt in range(CONNECT_ATTEMPTS):
		try:
			response = requests.request(
				method,
				url,
				json=json_body,
				params=params,
				headers=_headers(token, extra_headers),
				timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
			)
			break
		except requests.ConnectionError as exc:
			# Never sent. Safe to try again after a short pause.
			last_connection_error = exc
			if attempt + 1 < CONNECT_ATTEMPTS:
				time.sleep(CONNECT_BACKOFF_SECONDS * (attempt + 1))
				continue
			raise FBRUnsentError(
				_("Could not reach FBR for {0}: {1}").format(context, str(exc)[:200])
			)
		except requests.Timeout as exc:
			# The request left. FBR may have processed it. This must not be
			# retried automatically anywhere.
			raise FBRUncertainError(
				_(
					"FBR did not answer in time for {0}. It may have been recorded — check with FBR "
					"before sending it again. ({1})"
				).format(context, str(exc)[:200])
			)
		except requests.RequestException as exc:
			raise FBRUncertainError(
				_("The request to FBR for {0} failed: {1}").format(context, str(exc)[:200])
			)
	else:  # pragma: no cover - loop always breaks or raises
		raise FBRUnsentError(str(last_connection_error))

	_check_status(response, context)
	return _parse(response, context)


def post(url, token, payload, context, extra_headers=None):
	return request("POST", url, token, context, json_body=payload, extra_headers=extra_headers)


def get(url, token, context, params=None):
	return request("GET", url, token, context, params=params)
