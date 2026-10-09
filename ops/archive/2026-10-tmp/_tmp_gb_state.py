from frappe.utils import cstr

seller = "Golden Ball International"
pending = ["SN004","SN010","SN012","SN013","SN015","SN020","SN021","SN022","SN023","SN026","SN027","SN028"]

print("=== GB invoices ===")
for row in frappe.get_all(
    "Sale Tax Invoice",
    filters={"seller__business_name": seller},
    fields=["name","scenario_id","docstatus","fbr_invoice_no","sandbox_run_status"],
    order_by="scenario_id, name",
):
    print(row.name, row.scenario_id, "ds", row.docstatus, "fbr", cstr(row.fbr_invoice_no), row.sandbox_run_status)

print("=== GB tax items ===")
for row in frappe.get_all(
    "Tax Item",
    filters={"seller": seller},
    fields=["name","hs_code","product_uom","transaction_type","tax_desc","rate_in_p","rate_id","fixed_rs"],
    order_by="name",
):
    print(row.name, "|", row.transaction_type, "|", row.hs_code, row.product_uom, row.tax_desc, row.rate_in_p, "rid", row.rate_id, "fix", row.fixed_rs)

print("=== any posted for pending sns ===")
for sn in pending:
    posted = frappe.get_all(
        "Sale Tax Invoice",
        filters={"scenario_id": sn, "docstatus": 1},
        fields=["name","seller__business_name","fbr_invoice_no"],
        limit=5,
    )
    print(sn, posted)

print("=== HS 8517 / 98xx / 2710 ===")
for like in ("8517%", "8525%", "9803%", "9812%", "2710.19%", "8908%"):
    rows = frappe.get_all("HS Code", filters={"name": ["like", like]}, fields=["name"], limit=20)
    print(like, [r.name for r in rows])

print("=== buyers ===")
for row in frappe.get_all(
    "Buyer",
    filters={"seller": ["in", [seller, ""]]},
    fields=["name","seller","buyer_registration_type","buyer_ntncnic"],
    limit=30,
):
    print(row.name, row.seller, row.buyer_registration_type, row.buyer_ntncnic)

print("=== walk-in ===")
for name in ["Walk-in Buyer (Unregistered)", "Sandbox Unregistered Buyer (Golden Ball International)", "Sandbox Registered Buyer (Golden Ball International)"]:
    print(name, "exists" if frappe.db.exists("Buyer", name) else "NO")
