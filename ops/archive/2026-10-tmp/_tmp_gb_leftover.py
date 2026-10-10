from di.integrations.reference_api import (
    _get_token,
    _make_get_request,
    get_sro_schedules_for_rate,
    get_sro_items_for_schedule,
    get_sale_type_rates,
)
from di.constants import REF_BASE_V1, REF_BASE_V2

company = "Golden Ball International"
token = _get_token(company)

print("=== SRO 1023 CNG ===")
try:
    sch = get_sro_schedules_for_rate(1023, company=company) or []
    print(sch)
    if sch:
        print(get_sro_items_for_schedule(sch[0].get("sro_id"), company=company)[:10])
except Exception as e:
    print("sro 1023", e)

print("=== HS like ship / 890 ===")
for like in ("%SHIP%", "%8908%", "%VESSEL%BREAK%", "%HULK%"):
    rows = frappe.db.sql(
        "select name, description from `tabHS Code` where name like %s or description like %s limit 15",
        (like, like),
    )
    print(like, rows)

print("=== probe HS sale type endpoints ===")
paths = [
    ("/pdi/v1/itemdesccode", {"transTypeId": 125}),
    ("/pdi/v2/HS_CODE", {"transTypeId": 125}),
    ("/pdi/v2/SaleTypeToHs", {"transTypeId": 125}),
    ("/pdi/v1/SaleTypeToHsCode", {"transTypeId": 125}),
    ("/pdi/v2/HSCodeToSaleType", {"hs_code": "8908.0000"}),
]
for path, params in paths:
    try:
        rows = _make_get_request("https://gw.fbr.gov.pk" + path, token, path, params=params)
        print(path, type(rows), str(rows)[:300])
    except Exception as e:
        print(path, "ERR", str(e)[:200])

print("=== chlorate rate rows ===")
print(get_sale_type_rates(trans_type_id=115, origination_supplier=7, company=company))
