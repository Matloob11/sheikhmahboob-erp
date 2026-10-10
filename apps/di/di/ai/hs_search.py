"""HS Code lookup for the assistant.

The master holds ~7,800 FBR codes whose descriptions are the tariff hierarchy
joined with " - " ("NUCLEAR REACTORS ... - FILTERING OR PURIFYING MACHINERY -
FOR WATER"). A LIKE per word pulls candidates; ranking in Python prefers hits in
the leaf (the last segment) and in the short description, which is what a clerk
reads. `tokens` and `rank` are pure and unit-tested; `search` does the SQL.
"""

from __future__ import annotations

import re

STOPWORDS = frozenset(
	{
		"a",
		"an",
		"and",
		"are",
		"as",
		"at",
		"by",
		"etc",
		"for",
		"from",
		"in",
		"is",
		"its",
		"kind",
		"nes",
		"n.e.s",
		"not",
		"of",
		"on",
		"or",
		"other",
		"others",
		"than",
		"the",
		"thereof",
		"to",
		"used",
		"with",
		"whether",
	}
)

# A chapter (2 digits), heading (4) or a dotted code; three bare digits are not a code.
_CODE = re.compile(r"^(?:\d{2}|\d{4})(?:\.\d{0,4})?$")
_WORD = re.compile(r"[a-z0-9][a-z0-9.\-/]*")

FIELDS = ("name", "short_description", "description", "uom")
MAX_CANDIDATES = 500
MAX_LIMIT = 25


def is_code(query) -> bool:
	return bool(_CODE.match(str(query or "").strip()))


def tokens(query) -> list[str]:
	"""Lower-cased search words, stop words and one-letter fragments dropped."""
	seen = []
	for word in _WORD.findall(str(query or "").lower()):
		word = word.strip(".-/")
		if len(word) < 2 or word in STOPWORDS or word in seen:
			continue
		seen.append(word)
	return seen


def score(row, words, phrase) -> int:
	description = str(row.get("description") or "").lower()
	short = str(row.get("short_description") or "").lower()
	leaf = description.rsplit(" - ", 1)[-1]
	matched = 0
	points = 0
	for word in words:
		hit = False
		if word in leaf:
			points += 3
			hit = True
		if word in short:
			points += 2
			hit = True
		if word in description:
			points += 1
			hit = True
		if hit:
			matched += 1
	if words and matched == len(words):
		points += 4
	if phrase and len(phrase) > 3 and phrase in description:
		points += 4
	return points


def rank(rows, words, phrase, limit=10) -> list[dict]:
	phrase = " ".join(str(phrase or "").lower().split())
	scored = []
	for row in rows:
		points = score(row, words, phrase)
		if points <= 0:
			continue
		# Shorter descriptions are more specific tariff lines; prefer them on ties.
		scored.append((-points, len(str(row.get("description") or "")), str(row.get("name") or ""), row))
	scored.sort(key=lambda item: item[:3])
	return [item[3] for item in scored[:limit]]


def _row(row) -> dict:
	description = " ".join(str(row.get("description") or "").split())
	return {
		"hs_code": row.get("name"),
		"short_description": row.get("short_description") or "",
		"description": description[:220],
		"uom": row.get("uom") or "",
	}


def search(query, limit=10) -> list[dict]:
	"""Top matches from the HS Code master. Needs a site."""
	import frappe

	query = " ".join(str(query or "").split()).strip()
	if not query:
		return []
	limit = max(1, min(int(limit or 10), MAX_LIMIT))

	if is_code(query):
		rows = frappe.get_all(
			"HS Code",
			filters={"name": ["like", f"{query}%"]},
			fields=list(FIELDS),
			order_by="name asc",
			limit_page_length=limit,
		)
		return [_row(row) for row in rows]

	words = tokens(query)
	if not words:
		return []

	# One LIKE per word, OR-ed: cheap on 7,800 rows and it keeps every candidate
	# that any word touches; Python ranking decides the order. Values travel as
	# parameters, never inside the SQL text.
	clauses = []
	params = {}
	for index, word in enumerate(words[:8]):
		key = f"w{index}"
		clauses.append(f"(`description` like %({key})s or `short_description` like %({key})s)")
		params[key] = f"%{word}%"
	params["max_rows"] = MAX_CANDIDATES
	rows = frappe.db.sql(
		"select `name`, `short_description`, `description`, `uom` from `tabHS Code` where "
		+ " or ".join(clauses)
		+ " limit %(max_rows)s",
		params,
		as_dict=True,
	)
	return [_row(row) for row in rank(rows, words, query, limit)]


def get(hs_code) -> dict | None:
	"""One row by code, or None."""
	import frappe

	code = str(hs_code or "").strip()
	if not code:
		return None
	row = frappe.db.get_value("HS Code", code, list(FIELDS), as_dict=True)
	return _row(row) if row else None
