from di.integrations.reference_api import _get_token, _make_get_request, _row_value
from di.constants import REF_BASE_V2

print("=== Kashif SN026-28 ===")
for name in ["STI-0047", "STI-0048", "STI-0049", "STI-0065", "STI-0067"]:
    d = frappe.get_doc("Sale Tax Invoice", name)
    print(name, d.scenario_id, d.buyer, d.docstatus, d.fbr_invoice_no)
    for r in d.invoice_items:
        print(" ", r.description, r.hs_code, r.uom, r.sale_type, r.tax_rate_value, r.fixed_notified_value_or_retail_price, r.sro_schedule_no, r.sro_item_serial_no)

print("=== Walk-in ===")
b = frappe.get_doc("Buyer", "Walk-in Buyer (Unregistered)")
print({k: b.get(k) for k in ["buyer_businessname","buyer_registration_type","buyer_ntncnic","buyer_province","buyer_address","seller"]})

print("=== Transaction types ===")
wanted = [
    "Ship breaking","Telecommunication services","Petroleum Products",
    "Electricity Supply to Retailers","Mobile Phones","Electric Vehicle",
    "Cement /Concrete Block","Potassium Chlorate","CNG Sales",
    "Goods at standard rate (default)","3rd Schedule Goods","Goods at Reduced Rate",
]
for name in wanted:
    row = frappe.db.get_value("Transaction Type", name, ["transaction_type_id","transaction_desc"], as_dict=True)
    print(name, row)

print("=== HS_UOM candidates ===")
token = _get_token("Golden Ball International")
codes = [
    "8908.0000","7204.4990","2710.1911","2710.1992","2716.0000",
    "8517.1310","8517.1390","8517.1100","8517.1810","8703.8090",
    "2523.2900","2829.1910","2711.2100","9803.0000","9803.1000",
    "9803.2000","9812.2000","9812.1000","9801.5000",
]
for c in codes:
    if not frappe.db.exists("HS Code", c):
        print("NO HS", c)
        continue
    rows = _make_get_request("{}/HS_UOM".format(REF_BASE_V2), token, "HS Code Uoms", params={"hs_code": c, "annexure_id": 1}) or []
    print(c, [(_row_value(i, "description"), _row_value(i, "uoM_ID", "uom_id")) for i in rows[:6]])

print("=== SaleTypeToRate ===")
for name in wanted:
    tid = frappe.db.get_value("Transaction Type", name, "transaction_type_id")
    if not tid:
        continue
    rows = _make_get_request(
        "{}/SaleTypeToRate".format(REF_BASE_V2),
        token,
        "SaleTypeToRate",
        params={"date": "24-Feb-2024", "transTypeId": int(tid), "originationSupplier": 1},
    ) or []
    slim = []
    for i in rows[:8]:
        slim.append((
            _row_value(i, "ratE_ID", "rate_id", "rateId"),
            _row_value(i, "ratE_DESC", "rate_desc", "rateDesc"),
            _row_value(i, "ratE_VALUE", "rate_value", "rateValue"),
        ))
    print(tid, name, slim)
