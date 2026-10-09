from di.integrations.reference_api import _get_token, _make_get_request, _row_value
from di.constants import REF_BASE_V2

codes = ["7204.1010", "7204.1090", "7204.2100", "7204.2910", "7204.4100", "7204.4990"]
token = _get_token("Golden Ball International")
for c in codes:
    exists = frappe.db.exists("HS Code", c)
    rows = []
    if exists:
        rows = _make_get_request("{}/HS_UOM".format(REF_BASE_V2), token, "uom", params={"hs_code": c, "annexure_id": 1}) or []
    print(c, "exists" if exists else "NO", [(_row_value(i, "description"),) for i in rows[:5]])
