"""Rules the assistant applies before it touches the database.

No frappe, no network, so every rule here is unit-tested without a site. The
controller on Sale Tax Invoice stays the authority; these only keep the model
from handing it something it would reject or, worse, accept wrongly.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from di.constants import PRODUCT_UOM_OPTIONS
from di.fbr_scenarios import FBR_SCENARIOS

STANDARD_SALE_TYPE = "Goods at standard rate (default)"
EXEMPT_SALE_TYPE = "Exempt goods"

# The Select options on Seller Or Company and Buyer. FBR wants these exact strings.
PROVINCES = (
	"BALOCHISTAN",
	"AZAD JAMMU AND KASHMIR",
	"CAPITAL TERRITORY",
	"KHYBER PAKHTUNKHWA",
	"PUNJAB",
	"SINDH",
	"GILGIT BALTISTAN",
)

_PROVINCE_ALIASES = {
	"punjab": "PUNJAB",
	"sindh": "SINDH",
	"sind": "SINDH",
	"kpk": "KHYBER PAKHTUNKHWA",
	"kp": "KHYBER PAKHTUNKHWA",
	"khyber pakhtunkhwa": "KHYBER PAKHTUNKHWA",
	"khyber pakhtoonkhwa": "KHYBER PAKHTUNKHWA",
	"nwfp": "KHYBER PAKHTUNKHWA",
	"islamabad": "CAPITAL TERRITORY",
	"ict": "CAPITAL TERRITORY",
	"capital territory": "CAPITAL TERRITORY",
	"federal": "CAPITAL TERRITORY",
	"ajk": "AZAD JAMMU AND KASHMIR",
	"azad kashmir": "AZAD JAMMU AND KASHMIR",
	"azad jammu and kashmir": "AZAD JAMMU AND KASHMIR",
	"gb": "GILGIT BALTISTAN",
	"gilgit": "GILGIT BALTISTAN",
	"gilgit baltistan": "GILGIT BALTISTAN",
	"gilgit-baltistan": "GILGIT BALTISTAN",
	"balochistan": "BALOCHISTAN",
	"baluchistan": "BALOCHISTAN",
}

# FBR's own UOM descriptions, as stored in HS Uom. Users type "pcs" or "kgs".
# These only translate the user's wording; which unit FBR allows for an HS code
# is decided by the HS_UOM lookup, never by an alias.
_UOM_ALIASES = {
	"pcs": "Numbers, pieces, units",
	"pc": "Numbers, pieces, units",
	"piece": "Numbers, pieces, units",
	"pieces": "Numbers, pieces, units",
	"nos": "Numbers, pieces, units",
	"no": "NO",
	"unit": "Numbers, pieces, units",
	"units": "Numbers, pieces, units",
	"number": "Numbers, pieces, units",
	"numbers": "Numbers, pieces, units",
	"each": "Numbers, pieces, units",
	"kg": "KG",
	"kgs": "KG",
	"kilo": "KG",
	"kilos": "KG",
	"kilogram": "Kilogram",
	"kilograms": "Kilogram",
	"ltr": "Liter",
	"ltrs": "Liter",
	"litre": "Liter",
	"litres": "Liter",
	"liter": "Liter",
	"liters": "Liter",
	"l": "Liter",
	"mt": "MT",
	"ton": "MT",
	"tons": "MT",
	"tonne": "MT",
	"tonnes": "MT",
	"metric ton": "MT",
	"set": "SET",
	"sets": "SET",
	"pack": "Packs",
	"packs": "Packs",
	"packet": "Packs",
	"packets": "Packs",
	"dozen": "Dozen",
	"dozens": "Dozen",
	"dz": "Dozen",
	"m": "Meter",
	"mtr": "Meter",
	"meter": "Meter",
	"meters": "Meter",
	"metre": "Meter",
	"metres": "Meter",
	"sqft": "Square Foot",
	"sq ft": "Square Foot",
	"square foot": "Square Foot",
	"square feet": "Square Foot",
	"sqm": "Square Metre",
	"sq m": "Square Metre",
	"square meter": "Square Metre",
	"square metre": "Square Metre",
	"sqy": "SqY",
	"sq yd": "SqY",
	"square yard": "SqY",
	"bag": "Bag",
	"bags": "Bag",
	"pair": "Pair",
	"pairs": "Pair",
	"gallon": "Gallon",
	"gallons": "Gallon",
	"gram": "Gram",
	"grams": "Gram",
	"g": "Gram",
	"gm": "Gram",
	"pound": "Pound",
	"pounds": "Pound",
	"lb": "Pound",
	"lbs": "Pound",
	"kwh": "KWH",
	"mmbtu": "MMBTU",
	"carat": "Carat",
	"ft": "Foot",
	"foot": "Foot",
	"feet": "Foot",
	"barrel": "Barrels",
	"barrels": "Barrels",
	"cubic meter": "Cubic Metre",
	"cubic metre": "Cubic Metre",
	"cbm": "Cubic Metre",
	"40kg": "40KG",
	"40 kg": "40KG",
	"mw": "Mega Watt",
	"mega watt": "Mega Watt",
	"megawatt": "Mega Watt",
	"thousand unit": "Thousand Unit",
	"other": "Others",
	"others": "Others",
}

# Scenario by sale type, then by buyer kind. SN026-SN028 are the
# retailer-to-end-consumer variants FBR runs for unregistered buyers.
_SCENARIO_TABLE = {
	STANDARD_SALE_TYPE: {"Registered": "SN001", "Unregistered": "SN002"},
	"Goods at Reduced Rate": {"Registered": "SN005", "Unregistered": "SN028"},
	"3rd Schedule Goods": {"Registered": "SN008", "Unregistered": "SN027"},
}

# What kind of buyer FBR expects on each scenario; "any" when it does not care.
# SN005 and SN008 are the registered-buyer halves of the pairs above (the sandbox
# recipes in di.sandbox_drafts treat them the same way).
_SCENARIO_BUYER = {
	"SN001": "Registered",
	"SN002": "Unregistered",
	"SN005": "Registered",
	"SN008": "Registered",
	"SN009": "Registered",
	"SN026": "Unregistered",
	"SN027": "Unregistered",
	"SN028": "Unregistered",
}

# Sale types whose only sandbox recipe refuses an unregistered buyer (FBR 0100).
_REGISTERED_ONLY_SALE_TYPES = frozenset({"Cotton ginners"})

_DIGITS = re.compile(r"\D+")
_FLAT_RUPEE = re.compile(r"^\s*(rs\.?|rupees?)\s*\d+(\.\d+)?\s*$", re.IGNORECASE)
_LEADING_PERCENT = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*%")


def digits_only(value) -> str:
	return _DIGITS.sub("", str(value or ""))


def normalize_tax_id(value) -> tuple[str, str | None]:
	"""(number, kind) where kind is 'NTN' (7 digits), 'CNIC' (13 digits) or None.

	IRIS prints NTNs with a check digit ("9020028-3"); FBR's invoice API wants
	the seven digits before the dash. Eight digits with no dash cannot be told
	apart from a typo, so they are refused rather than guessed.
	"""
	text = str(value or "").strip()
	digits = digits_only(text)
	if len(digits) == 13:
		return digits, "CNIC"
	if len(digits) == 7:
		return digits, "NTN"
	if "-" in text:
		head = digits_only(text.split("-", 1)[0])
		if len(head) == 7 and len(digits) == 8:
			return head, "NTN"
	return digits, None


def classify_tax_id(value) -> str | None:
	return normalize_tax_id(value)[1]


def buyer_identity_error(registration_type, ntn_cnic) -> str | None:
	"""Why a buyer cannot be created with these details, or None when it can."""
	kind = (registration_type or "").strip()
	if kind not in ("Registered", "Unregistered"):
		return "registration_type must be 'Registered' or 'Unregistered'."
	number, id_kind = normalize_tax_id(ntn_cnic)
	if not number:
		return "NTN or CNIC is required. Ask the user for it; never guess one."
	if set(number) == {"0"}:
		return "An all-zero NTN/CNIC is a placeholder, not an identity. Ask the user for the real number."
	if id_kind is None:
		if len(number) == 8:
			return (
				"8 digits are ambiguous: if the last digit is the IRIS check digit, write it as 1234567-8; "
				"otherwise give the 7-digit NTN."
			)
		return "NTN must be 7 digits (IRIS form 1234567-8 is accepted) and CNIC 13 digits."
	return None


def normalize_province(value) -> str | None:
	"""Map what a user typed to the Select option, or None when it is not a province."""
	raw = " ".join(str(value or "").split()).strip()
	if not raw:
		return None
	upper = raw.upper()
	if upper in PROVINCES:
		return upper
	return _PROVINCE_ALIASES.get(raw.lower())


def normalize_uom(value, options=PRODUCT_UOM_OPTIONS) -> str | None:
	"""Return the curated FBR UOM string for a user's spelling, or None."""
	raw = " ".join(str(value or "").split()).strip()
	if not raw:
		return None
	lowered = raw.lower()
	for option in options:
		if option.lower() == lowered:
			return option
	alias = _UOM_ALIASES.get(lowered) or _UOM_ALIASES.get(lowered.rstrip("."))
	if alias and alias in options:
		return alias
	return None


def is_flat_rupee_rate(tax_desc) -> bool:
	"""'Rs.2', 'Rs.200': a rupee amount per unit with no percentage.

	The invoice controller treats rate_in_p as a percentage, so these lines
	would carry the wrong sales tax; they must be entered by hand for now.
	"""
	return bool(_FLAT_RUPEE.match(str(tax_desc or "")))


def buyer_kind(registration_type) -> str:
	return "Unregistered" if (registration_type or "").strip().lower() == "unregistered" else "Registered"


def canonical_sale_type(value) -> str | None:
	"""The sale type as the scenario table spells it, matched without regard to case."""
	text = " ".join(str(value or "").split()).casefold()
	if not text:
		return None
	for name in [STANDARD_SALE_TYPE, EXEMPT_SALE_TYPE, *known_sale_types()]:
		if name.casefold() == text:
			return name
	return None


def scenario_for(sale_type, buyer_registration_type) -> str | None:
	"""Scenario the current data model needs for this sale type and buyer.

	None means the combination is unknown or refused by FBR (cotton ginners to
	an unregistered buyer, error 0100).
	"""
	wanted = canonical_sale_type(sale_type) or (sale_type or "").strip() or STANDARD_SALE_TYPE
	kind = buyer_kind(buyer_registration_type)
	if wanted in _REGISTERED_ONLY_SALE_TYPES and kind == "Unregistered":
		return None
	by_kind = _SCENARIO_TABLE.get(wanted)
	if by_kind:
		return by_kind[kind]
	for sn_no, _description, scenario_sale_type in FBR_SCENARIOS:
		if sn_no in _SCENARIO_BUYER and _SCENARIO_BUYER[sn_no] != kind and sn_no not in ("SN009",):
			continue
		if scenario_sale_type == wanted:
			return sn_no
	return None


def scenario_buyer_kind(sn_no) -> str:
	return _SCENARIO_BUYER.get((sn_no or "").strip().upper(), "any")


def scenario_matches_buyer(sn_no, buyer_registration_type) -> bool:
	expected = scenario_buyer_kind(sn_no)
	return expected == "any" or expected == buyer_kind(buyer_registration_type)


def sale_type_for_scenario(sn_no) -> str:
	code = (sn_no or "").strip().upper()
	for scenario, _description, sale_type in FBR_SCENARIOS:
		if scenario == code:
			return sale_type
	return ""


def known_sale_types() -> list[str]:
	seen = []
	for _sn_no, _description, sale_type in FBR_SCENARIOS:
		if sale_type and sale_type not in seen:
			seen.append(sale_type)
	return seen


def parse_rate(value) -> tuple[str, float] | None:
	"""'18', '18%', 18 -> ('18%', 18.0). Compound FBR literals are left to the user."""
	if value in (None, ""):
		return None
	if isinstance(value, (int, float, Decimal)):
		number = Decimal(str(value))
	else:
		text = str(value).strip().replace(" ", "")
		if not re.fullmatch(r"\d+(\.\d+)?%?", text):
			return None
		try:
			number = Decimal(text.rstrip("%"))
		except InvalidOperation:
			return None
	if number < 0 or number > 100:
		return None
	formatted = format(number.normalize(), "f")
	if "." in formatted:
		formatted = formatted.rstrip("0").rstrip(".")
	return f"{formatted or '0'}%", float(number)


def leading_percent(tax_desc) -> float | None:
	"""'18% along with rupees 60 per kilogram' -> 18.0; None when the text does not start with a percentage."""
	match = _LEADING_PERCENT.match(str(tax_desc or ""))
	return float(match.group(1)) if match else None


def plain_rate(tax_desc, rate_in_p) -> float | None:
	"""The rate as a number when tax_desc is a bare percentage or blank; None for an FBR literal.

	'18% along with rupees 60 per kilogram' and '18% and Rs. 80 per Liter' carry
	18 in rate_in_p, but they are not 18% items: the number alone says nothing.
	"""
	parsed = parse_rate(tax_desc)
	if parsed:
		return parsed[1]
	if str(tax_desc or "").strip():
		return None
	try:
		return float(rate_in_p) if rate_in_p not in (None, "") else None
	except (TypeError, ValueError):
		return None


def infer_sale_type(transaction_type, tax_desc, rate_in_p) -> tuple[str | None, str]:
	"""Sale type for a Tax Item whose transaction_type is blank, when it is unambiguous.

	Returns (sale_type, reason). A 0% item could be zero-rated, exempt or
	non-adjustable, and a compound FBR literal belongs to its own sale type, so
	both are left to the user.
	"""
	explicit = (transaction_type or "").strip()
	if explicit:
		return explicit, ""
	desc = (tax_desc or "").strip()
	if desc.lower() == "exempt":
		return EXEMPT_SALE_TYPE, "inferred from the rate text 'Exempt'"
	rate = plain_rate(tax_desc, rate_in_p)
	if rate == 18:
		return STANDARD_SALE_TYPE, "inferred from the 18% rate"
	if rate is None and desc:
		return None, (
			f"the item has no sale type and its rate text {desc!r} is an FBR literal, not a plain percentage; "
			"ask which FBR sale type applies (lookup_fbr_rate lists them)"
		)
	return None, "the item has no sale type and its rate is not 18%; ask which FBR sale type applies"


def standard_rate_mismatch(sale_type, tax_desc, rate_in_p) -> str | None:
	"""Standard-rate items must carry a plain 18%; anything else is rejected by FBR (0046/0104)."""
	if (sale_type or "").strip().casefold() != STANDARD_SALE_TYPE.casefold():
		return None
	if plain_rate(tax_desc, rate_in_p) != 18:
		return (
			f"'{STANDARD_SALE_TYPE}' must carry a plain 18% rate, not {tax_desc or rate_in_p!r}. "
			"Use the matching sale type."
		)
	return None


def unique_name(base, exists, suffix) -> str:
	"""First free name among base, 'base (suffix)', 'base (suffix) 2', ..."""
	base = " ".join(str(base or "").split())[:140]
	if base and not exists(base):
		return base
	candidate = f"{base} ({suffix})"[:140]
	if not exists(candidate):
		return candidate
	for n in range(2, 50):
		numbered = f"{candidate[:130]} {n}"
		if not exists(numbered):
			return numbered
	raise ValueError(f"Could not find a free name for {base!r}")


def clip(text, limit=300) -> str:
	text = " ".join(str(text or "").split())
	if len(text) <= limit:
		return text
	return text[: limit - 1].rstrip() + "…"


def parse_quantity(value) -> float | None:
	try:
		number = float(value)
	except (TypeError, ValueError):
		return None
	if number <= 0:
		return None
	return round(number, 4)


def parse_amount(value) -> float | None:
	try:
		number = float(value)
	except (TypeError, ValueError):
		return None
	if number < 0:
		return None
	return round(number, 2)


def normalize_hs_code(value) -> str:
	"""'84212100' and '8421 2100' -> '8421.2100'; anything else is returned trimmed."""
	collapsed = " ".join(str(value or "").split())
	compact = collapsed.replace(" ", "")
	if re.fullmatch(r"\d{8}", compact):
		return f"{compact[:4]}.{compact[4:]}"
	return collapsed


def mask_identity(number) -> str:
	"""Last four digits only; the model does not need a full CNIC to pick a buyer."""
	digits = digits_only(number)
	if len(digits) <= 4:
		return digits
	return "*" * (len(digits) - 4) + digits[-4:]


# What the model should do next for the FBR errors a draft usually hits.
FBR_ERROR_HINTS = {
	"0046": "The rate is not valid for this sale type: check tax_desc with lookup_fbr_rate.",
	"0052": "The HS code does not match the sale type: pick an HS code FBR maps to that sale type, or change the sale type.",
	"0053": "FBR says the buyer's registration type does not match its profile: check_buyer_registration, then update the Buyer.",
	"0058": "Buyer and seller share one NTN/CNIC: FBR refuses self-invoicing; the buyer needs its own identity.",
	"0077": "An SRO schedule is required for this rate: lookup_fbr_rate, lookup_sro_schedules, then update_draft_invoice.",
	"0078": "The SRO item serial is not valid for that schedule: lookup_sro_serials and use one of them.",
	"0090": "3rd Schedule / SRO 297 goods need the printed retail price per unit (fixed_notified_value_or_retail_price).",
	"0096": "Only KWH is allowed as UOM for this HS code.",
	"0097": "The UOM for this HS code must be KG.",
	"0099": "The UOM is not allowed for this HS code: lookup_fbr_uom and update the Tax Item (update_tax_item).",
	"0100": "Cotton ginner sales are allowed to registered buyers only.",
	"0102": "Sales tax on 3rd Schedule goods must be computed on the retail price.",
	"0104": "The sales tax does not match rate x value: check the rate and the retail price.",
	"0105": "The sales tax for this quantity is wrong: a per-unit rupee rate cannot be computed here; enter the line by hand.",
	"0106": "The buyer is not registered for sales tax on FBR's list: set the Buyer to Unregistered or check_buyer_registration.",
	"0107": "The buyer's registration number does not match FBR's record: verify the NTN/CNIC.",
}
