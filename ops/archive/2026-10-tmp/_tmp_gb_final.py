sns = ["SN004","SN010","SN012","SN013","SN015","SN020","SN021","SN022","SN023","SN026","SN027","SN028"]
for sn in sns:
    row = frappe.db.get_value(
        "Sale Tax Invoice",
        {"seller__business_name": "Golden Ball International", "scenario_id": sn, "docstatus": 1, "fbr_invoice_no": ["!=", ""]},
        ["name", "fbr_invoice_no"],
        as_dict=True,
    )
    print(sn, row or "PENDING")
