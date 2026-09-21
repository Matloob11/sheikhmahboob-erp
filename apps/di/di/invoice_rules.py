"""FBR invoice rules that do not need a site or network.

SRO is not “anything that is not 18%”. Telecom 17% and electricity 5% posted
with an empty schedule. Mobile phones at 18% were rejected without one. The
sale type is the signal, not the percentage.

3rd Schedule Goods is different: FBR sandbox accepts an empty SRO, but rejects
fixedNotifiedValueOrRetailPrice = 0 (error 0090).
"""

from __future__ import annotations

import re
from decimal import Decimal

from di.constants import SRO_REQUIRED_SALE_TYPES

SRO_REQUIRED = frozenset(SRO_REQUIRED_SALE_TYPES)
THIRD_SCHEDULE = "3rd Schedule Goods"
SRO_297 = "Goods as per SRO.297(|)/2023"
# FBR 0090. SRO 297 uses the same 3rd-schedule wording when retail is 0.
RETAIL_PRICE_SALE_TYPES = frozenset({THIRD_SCHEDULE, SRO_297})
DEFAULT_RETAIL_PRICE = 1000.0


def row_needs_sro(tax_rate=None, sale_type: str = "", schedule: str = "") -> bool:
	"""True when FBR will reject this line without sroScheduleNo / sroItemSerialNo."""
	if str(schedule or "").strip():
		return False
	return str(sale_type or "").strip() in SRO_REQUIRED


def _as_amount(value) -> Decimal:
	try:
		return Decimal(str(value or 0))
	except Exception:
		return Decimal("0")


def sale_type_needs_retail_price(sale_type: str = "") -> bool:
	return str(sale_type or "").strip() in RETAIL_PRICE_SALE_TYPES


def row_needs_retail_price(sale_type: str = "", retail_price=None) -> bool:
	"""True when FBR 0090 will fire for this line."""
	if not sale_type_needs_retail_price(sale_type):
		return False
	return _as_amount(retail_price) <= 0


def fallback_retail_price(sale_rate=None, fixed_rs=None) -> float:
	"""Use the notified price, else the unit sale rate. Never send 0."""
	for value in (fixed_rs, sale_rate):
		amount = _as_amount(value)
		if amount > 0:
			return float(amount)
	return 0.0


def settled_retail_price(sale_type: str = "", retail_price=None, sale_rate=None) -> float:
	"""Value to send FBR. 3rd Schedule / SRO 297 must never go out as 0."""
	if not sale_type_needs_retail_price(sale_type):
		return float(_as_amount(retail_price))
	value = fallback_retail_price(sale_rate, retail_price)
	return value if value > 0 else DEFAULT_RETAIL_PRICE


def fbr_product_description(name: str = "", sale_type: str = "") -> str:
	"""FBR checks this string. Item names are unique per seller; the API is not."""
	text = str(name or "").strip()
	if str(sale_type or "").strip() == "Petroleum Products":
		return "Petroleum Products"
	if text.endswith(")") and " (" in text:
		base = text[: text.rfind(" (")].strip()
		if base:
			return base
	return text


def extra_rupees_per_qty(rate_text) -> Decimal:
	"""Compound FBR rates such as '18% along with rupees 60 per kilogram'.

	Budget 2026–27 FED-in-ST goods use '18% and Rs. 80 per Liter'. 'Rs.2'
	is a flat rupee rate, not per-qty, so it stays 0.
	"""
	match = re.search(
		r"(?:rupees|rs\.?)\s+(\d+(?:\.\d+)?)\s+per",
		str(rate_text or ""),
		flags=re.I,
	)
	if not match:
		return Decimal("0")
	return Decimal(match.group(1))


def petroleum_levy_on(sale_type: str, quantity) -> float | None:
	if str(sale_type or "").strip() != "Petroleum Products":
		return None
	try:
		qty = float(quantity or 0)
	except (TypeError, ValueError):
		qty = 0
	return qty or 1.0


def is_retryable_fbr_error(message: str) -> bool:
	"""True when another HS / rate / UOM recipe is worth trying."""
	text = str(message or "").lower()
	markers = (
		"efs license",
		"not an efs",
		"compressor scrap",
		"rate is not correct",
		"provided rate is not correct",
		"please provide valid rate",
		"rate must be valid",
		"hs code",
		"invalid uom",
		"uom is not allowed",
		"only kwh",
		"provide uom",
		"provide valid uom",
		"valid uom",
		"uom must be",
		"minimum notified price",
		"declared price is less than",
		"hs code does not match",
		"retail price is mandatory",
		"retail price is required",
		"fixed/notified value",
		"fixed notified value",
	)
	return any(marker in text for marker in markers)


def is_unassigned_scenario_error(message: str) -> bool:
	"""True when this taxpayer's token does not have that sandbox scenario."""
	text = str(message or "").lower()
	return "scenario does not exist" in text
