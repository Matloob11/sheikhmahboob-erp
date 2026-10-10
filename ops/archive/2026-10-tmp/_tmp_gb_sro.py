from di.integrations.reference_api import (
    get_sro_schedules_for_rate,
    get_sro_items_for_schedule,
    get_sale_type_rates,
    _get_company_province_code,
)
from frappe.utils import cstr

company = "Golden Ball International"
print("province", _get_company_province_code(company))

print("=== CNG rates all origins ===")
for origin in [None, 1, 2, 3, 4, 5, 6, 7, _get_company_province_code(company)]:
    try:
        rows = get_sale_type_rates(trans_type_id=178, origination_supplier=origin, company=company) or []
    except Exception as e:
        print("origin", origin, "ERR", e)
        continue
    print("origin", origin, "n", len(rows), rows[:3])

print("=== petroleum all rates ===")
rows = get_sale_type_rates(trans_type_id=85, origination_supplier=1, company=company) or []
print("n", len(rows))
for r in rows:
    print(r)

print("=== STI-0047 ntn ===")
d = frappe.get_doc("Sale Tax Invoice", "STI-0047")
print("buyer_ntncnic", d.buyer_ntncnic, "reg", d.buyer_registration_type)

print("=== SRO for rates ===")
for rid, label in [
    (745, "ship 18"),
    (343, "telecom 17"),
    (146, "telecom 18.5"),
    (654, "petrol 0"),
    (645, "petrol 0.20"),
    (147, "elec 5"),
    (110, "elec 7.5"),
    (736, "phone 18"),
    (735, "phone 25"),
    (625, "ev 1"),
    (629, "cement rs2"),
    (631, "cement rs3"),
    (734, "chlorate 18+60"),
    (413, "reduced 1"),
    (728, "std 18"),
]:
    try:
        sch = get_sro_schedules_for_rate(rid, company=company) or []
    except Exception as e:
        print(rid, label, "ERR", e)
        continue
    print(rid, label, [(x.get("sro_id"), x.get("sro_desc")) for x in sch[:6]], "n", len(sch))
    if sch:
        sid = sch[0].get("sro_id")
        try:
            items = get_sro_items_for_schedule(sid, company=company) or []
            print("  serials", [(x.get("serial"), x.get("sro_item_id")) for x in items[:8]], "n", len(items))
        except Exception as e:
            print("  serials ERR", e)

print("=== HS desc ===")
for c in ["8908.0000","2710.1911","2710.1992","2716.0000","8517.1310","8703.8090","2523.2900","2829.1910","2711.2100","9803.0000"]:
    print(c, frappe.db.get_value("HS Code", c, "hs_code_description") or frappe.db.get_value("HS Code", c, "description"))
