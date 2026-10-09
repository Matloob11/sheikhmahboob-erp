"""Sandbox-only SN017 submit for FAIZ ALAM. Do not print tokens."""
import json

import frappe


def main():
	company = None
	for row in frappe.get_all("DI Settings", fields=["name", "company", "sync_mode"]):
		name = (row.company or row.name or "").strip()
		print("SETTINGS", name, row.sync_mode)
		if "FAIZ ALAM" in name.upper():
			company = name
	if not company:
		print("RESULT", json.dumps({"error": "FAIZ ALAM DI Settings not found"}))
		return

	seller = frappe.db.get_value(
		"Sale Tax Invoice",
		{"seller__business_name": ["like", "%FAIZ ALAM%"], "docstatus": 1},
		"seller__business_name",
	)
	print("COMPANY", company)
	print("SELLER", seller or "")

	posted = frappe.get_all(
		"Sale Tax Invoice",
		filters={"seller__business_name": ["like", "%FAIZ ALAM%"], "docstatus": 1},
		fields=["name", "scenario_id", "fbr_invoice_no"],
		order_by="scenario_id",
		limit=20,
	)
	print("POSTED", json.dumps(posted, default=str))

	drafts = frappe.get_all(
		"Sale Tax Invoice",
		filters={"seller__business_name": ["like", "%FAIZ ALAM%"], "docstatus": 0},
		fields=["name", "scenario_id"],
		limit=20,
	)
	print("DRAFTS", json.dumps(drafts, default=str))

	from di.sandbox_drafts import create_sandbox_drafts

	result = create_sandbox_drafts(company, ["SN017"])
	print("SUBMIT", json.dumps(result, default=str))


if __name__ == "__main__":
	main()
