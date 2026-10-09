from di.integrations.reference_api import fetch_hs_code_uom, _get_token, _make_get_request, _row_value
from di.constants import REF_BASE_V2

codes = [
    "8908.0000", "7204.4990", "2710.1911", "2710.1992", "2710.1210",
    "2716.0000", "8517.1219", "8517.1210", "8517.1290",
    "8703.8090", "8703.8030", "2523.2900", "2523.1000",
    "2829.1910", "2711.2100", "2711.1100",
    "9803.0000", "9812.2000", "9812.5000", "8525.8020",
]
for c in codes:
    exists = frappe.db.exists("HS Code", c)
    print(c, "exists" if exists else "NO")

token = _get_token("Golden Ball International")
for c in ["8908.0000", "7204.4990", "2710.1911", "2716.0000", "8517.1219", "8703.8090", "2523.2900", "2829.1910", "2711.2100", "9803.0000"]:
    if not frappe.db.exists("HS Code", c):
        continue
    rows = _make_get_request("{}/HS_UOM".format(REF_BASE_V2), token, "HS Code Uoms", params={"hs_code": c, "annexure_id": 1}) or []
    print("UOM", c, [(_row_value(i, "description"), _row_value(i, "uoM_ID", "uom_id")) for i in rows[:4]])
