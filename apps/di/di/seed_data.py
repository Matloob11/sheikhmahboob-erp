import hashlib
import json
import re
from pathlib import Path

import frappe

from di.constants import PRODUCT_UOM_OPTIONS

HS_UOMS = list(PRODUCT_UOM_OPTIONS)

DI_ERROR_CODES = [
	("0001", "Sales", "Seller not registered for sales tax", "Provide valid seller registration/NTN."),
	("0002", "Sales", "Invalid Buyer Registration No or NTN", "Buyer registration number or NTN format is invalid."),
	("0003", "Sales", "Provide proper invoice type", "Invoice type is not valid or empty."),
	("0005", "Sales", "Please provide date in valid format", "Invoice date must be provided in the required format."),
	("0006", "Sales", "Sale invoice not exist", "Sales invoice does not exist against STWH."),
	("0007", "Sales", "Wrong sale type is selected", "Select the proper sale type for the invoice."),
	("0008", "Sales", "Invalid ST withheld at source", "ST withheld at source should be zero or equal to sales tax where required."),
	("0009", "Sales", "Provide buyer registration no", "Buyer registration number cannot be empty."),
	("0010", "Sales", "Provide buyer name", "Buyer name cannot be empty."),
	("0011", "Sales", "Provide invoice type", "Invoice type cannot be empty."),
	("0012", "Sales", "Provide buyer registration type", "Buyer registration type cannot be empty."),
	("0013", "Sales", "Provide valid sale type", "Sale type cannot be empty or invalid."),
	("0018", "Sales", "Please provide Sales Tax/FED in ST mode", "Sales Tax/FED cannot be empty."),
	("0019", "Sales", "Please provide HS Code", "HS Code cannot be empty."),
	("0020", "Sales", "Please provide rate", "Rate field cannot be empty."),
	("0021", "Sales", "Please provide value of sales excluding ST / quantity", "Sales value or quantity is required."),
	("0022", "Sales", "Please provide ST withheld at source", "ST withheld at source cannot be empty where required."),
	("0023", "Sales", "Please provide Sales Tax", "Sales Tax cannot be empty."),
	("0024", "Sales", "Please provide ST withheld", "Sales Tax withheld cannot be empty where required."),
	("0043", "Sales", "Provide valid date", "Invoice date is not valid."),
	("0044", "Sales", "Provide HS Code", "HS Code cannot be empty."),
	("0046", "Sales", "Provide rate", "Rate must be valid as per selected sale type."),
	("0050", "Sales", "Please provide valid Sales Tax", "Sales Tax value is invalid."),
	("0089", "Sales", "Please provide FED charged", "FED charged cannot be empty where required."),
	("0090", "Sales", "Please provide fixed/notified value or retail price", "Fixed/notified value or retail price is required."),
	("0091", "Sales", "Extra tax must be empty", "Extra tax must be empty for the selected sale type."),
	("0092", "Sales", "Provide valid sale type", "Purchase/sale type cannot be empty."),
	("0093", "Sales", "Selected sale type is not allowed to manufacturer", "Select a proper sale type."),
	("0095", "Sales", "Please provide extra tax", "Extra tax cannot be empty where required."),
	("0096", "Sales", "Only KWH UOM is allowed", "For selected HS Code only KWH UOM is allowed."),
	("0097", "Sales", "Provide UOM KG", "Please provide UOM in KG."),
	("0098", "Sales", "Please provide quantity / electricity units", "Quantity or electricity units cannot be empty."),
	("0099", "Sales", "Provide valid UOM", "UOM must be according to the given HS Code."),
	("0100", "Sales", "Cotton ginners allowed against registered buyers only", "Only cotton ginner sale type is allowed."),
	("0101", "Sales", "Use toll manufacturing sale type for steel sector", "Select Toll Manufacturing Sale Type for Steel Sector."),
	("0102", "Sales", "Calculated tax not matched in 3rd schedule", "Sales tax is not calculated as per 3rd schedule formula."),
	("0103", "Sales", "Calculated tax for Potassium Chlorate does not match", "Calculated value does not match potassium chlorate rules."),
	("0104", "Sales", "Calculated percentage sales tax does not match", "Calculation must match the provided rate."),
	("0105", "Sales", "Calculated sales tax for quantity is incorrect", "Calculated sales tax for the quantity is incorrect."),
	("0106", "Sales", "Buyer is not registered for sales tax", "Provide a valid buyer registration/NTN."),
	("0107", "Sales", "Mismatch buyer registration no", "Buyer registration number does not match."),
	("0108", "Sales", "Invalid seller registration no or NTN", "Seller registration number/NTN is invalid."),
	("0109", "Sales", "Wrong invoice type selected", "Select the proper invoice type."),
	("0111", "Sales", "Wrong purchase type selected", "Provide the proper purchase type."),
	("0113", "Sales", "System is unable to parse date", "Provide date in a valid format."),
	("0300", "Sales", "Provided decimal value is invalid", "One or more decimal fields contain invalid values."),
]


def seed_hs_uoms():
	if not frappe.db.exists("DocType", "HS Uom"):
		return {"inserted": 0, "updated": 0, "deleted": 0}

	allowed = set(HS_UOMS)
	inserted = 0
	updated = 0
	deleted = 0

	for row in frappe.get_all("HS Uom", fields=["name"], limit_page_length=0):
		if row.name not in allowed:
			frappe.delete_doc("HS Uom", row.name, ignore_permissions=True, force=True)
			deleted += 1

	for idx, uom_name in enumerate(HS_UOMS, start=1):
		if frappe.db.exists("HS Uom", uom_name):
			frappe.db.set_value(
				"HS Uom",
				uom_name,
				{"uom_id": idx, "uom_name": uom_name, "idx": idx},
				update_modified=False,
			)
			updated += 1
		else:
			doc = frappe.get_doc(
				{
					"doctype": "HS Uom",
					"uom_name": uom_name,
					"uom_id": idx,
					"idx": idx,
				}
			)
			doc.insert(ignore_permissions=True)
			inserted += 1

	if frappe.db.exists("DocType", "HS Code"):
		frappe.db.sql(
			"""
			update `tabHS Code`
			set uom = NULL
			where ifnull(uom, '') != ''
				and uom not in %(uoms)s
			""",
			{"uoms": tuple(HS_UOMS)},
		)

	return {"inserted": inserted, "updated": updated, "deleted": deleted}


HS_CODES_DIGEST_KEY = "di_hs_codes_digest"

# FBR HS codes are always eight digits written as NNNN.NNNN. The bundled
# hs_codes.json is a bad scrape: only 6 of its 7,767 rows match, the rest are
# fragments such as ".2" or "2.292" that came from splitting descriptions on
# the decimal point. Seeding them created thousands of junk HS Code records
# that users could pick and that FBR would reject, and because the same
# fragment repeats under different sr_no values every full seed rewrote them
# again. Anything that does not match is skipped; the real master data comes
# from reference_api.sync_hs_codes().
HS_CODE_PATTERN = re.compile(r"^\d{4}\.\d{4}$")


def seed_hs_codes(force=False):
	if not frappe.db.exists("DocType", "HS Code"):
		return {"inserted": 0, "updated": 0, "skipped": 0}

	data_path = Path(frappe.get_app_path("di", "data", "hs_codes.json"))
	if not data_path.exists():
		return {"inserted": 0, "updated": 0, "skipped": 0}

	raw = data_path.read_bytes()
	digest = hashlib.sha256(raw).hexdigest()

	# after_migrate calls this on every deploy, and a full pass reads the whole
	# HS Code table to compare ~11.6k rows against a 2 MB file. Skip that work
	# when the bundled data has not changed since the last successful seed.
	if not force and frappe.db.get_default(HS_CODES_DIGEST_KEY) == digest:
		return {"inserted": 0, "updated": 0, "skipped": 0, "unchanged": True}

	records = json.loads(raw.decode("utf-8"))
	existing = {
		row.get("name"): (row.get("description"), row.get("sr_no"), row.get("short_description"))
		for row in frappe.get_all(
			"HS Code",
			fields=["name", "description", "sr_no", "short_description"],
			limit_page_length=0,
		)
	}

	inserted = 0
	updated = 0
	skipped = 0

	for idx, row in enumerate(records):
		hs_code = row.get("hs_code")
		description = row.get("description") or ""
		sr_no = idx + 1

		words = description.split()
		short_description = " ".join(words[:5])
		if len(words) > 5:
			short_description += "..."

		if not hs_code or not HS_CODE_PATTERN.match(str(hs_code)):
			skipped += 1
			continue

		if hs_code in existing:
			existing_desc, existing_sr_no, existing_short_desc = existing[hs_code]
			if (
				(existing_desc or "") != description
				or existing_sr_no != sr_no
				or (existing_short_desc or "") != short_description
			):
				frappe.db.set_value(
					"HS Code",
					hs_code,
					{
						"description": description,
						"sr_no": sr_no,
						"short_description": short_description,
					},
					update_modified=False,
				)
				existing[hs_code] = (description, sr_no, short_description)
				updated += 1
			else:
				skipped += 1
			continue

		frappe.get_doc(
			{
				"doctype": "HS Code",
				"hs_code": hs_code,
				"description": description,
				"sr_no": sr_no,
				"short_description": short_description,
			}
		).insert(ignore_permissions=True)
		existing[hs_code] = (description, sr_no, short_description)
		inserted += 1

	frappe.db.set_default(HS_CODES_DIGEST_KEY, digest)

	return {"inserted": inserted, "updated": updated, "skipped": skipped}


def seed_sandbox_scenarios_from_scenarios():
	if not frappe.db.exists("DocType", "Sandbox Scenario") or not frappe.db.exists("DocType", "Scenario"):
		return {"inserted": 0, "updated": 0, "skipped": 0}

	inserted = 0
	updated = 0
	skipped = 0
	scenarios = frappe.get_all(
		"Scenario",
		fields=["sn_no", "description", "sale__purchase_type"],
		limit_page_length=0,
	)
	for row in scenarios:
		if not row.sn_no:
			skipped += 1
			continue

		sale_type = row.sale__purchase_type if frappe.db.exists("Sale Type", row.sale__purchase_type) else None
		if frappe.db.exists("Sandbox Scenario", row.sn_no):
			frappe.db.set_value(
				"Sandbox Scenario",
				row.sn_no,
				{"description": row.description, "sale_type": sale_type},
				update_modified=False,
			)
			updated += 1
			continue

		frappe.get_doc(
			{
				"doctype": "Sandbox Scenario",
				"scenario_id": row.sn_no,
				"description": row.description,
				"sale_type": sale_type,
			}
		).insert(ignore_permissions=True)
		inserted += 1

	return {"inserted": inserted, "updated": updated, "skipped": skipped}


def seed_di_error_codes():
	if not frappe.db.exists("DocType", "DI Error Code"):
		return {"inserted": 0, "updated": 0}

	inserted = 0
	updated = 0
	for error_code, category, message, description in DI_ERROR_CODES:
		values = {
			"category": category,
			"message": message,
			"description": description,
		}
		if frappe.db.exists("DI Error Code", error_code):
			frappe.db.set_value("DI Error Code", error_code, values, update_modified=False)
			updated += 1
			continue

		frappe.get_doc(
			{
				"doctype": "DI Error Code",
				"error_code": error_code,
				**values,
			}
		).insert(ignore_permissions=True)
		inserted += 1

	return {"inserted": inserted, "updated": updated}
