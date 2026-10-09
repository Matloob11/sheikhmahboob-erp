import json

from di.constants import DI_BASE_URL, DI_POST_SANDBOX, REF_BASE_V1, REF_BASE_V2
from di.integrations.di_api import _make_request
from di.integrations.reference_api import (
	_get_token,
	_make_get_request,
	get_sale_type_rates,
	get_sro_items_for_schedule,
	get_sro_schedules_for_rate,
)

frappe.set_user("Administrator")

SELLER = "Golden Ball International"
token = _get_token(SELLER)
post_url = f"{DI_BASE_URL}{DI_POST_SANDBOX}"

doc = frappe.get_doc("Sale Tax Invoice", "STI-0083")
print("draft", doc.name, doc.docstatus, doc.fbr_invoice_no, doc.buyer, doc.seller_ntncnic)

print("=== rates 85 ===")
rates = get_sale_type_rates(trans_type_id=85, company=SELLER) or []
for r in rates:
	print(r)

print("=== raw SROItem 401 ===")
print(_make_get_request(f"{REF_BASE_V2}/SROItem", token, "SRO", params={"date": "2026-08-23", "sro_id": 401}))

print("=== probe extra endpoints ===")
for path in [
	"/petroleumproduct",
	"/PetroleumProduct",
	"/itemdesc",
	"/ProductDescription",
]:
	try:
		rows = _make_get_request(f"{REF_BASE_V1}{path}", token, path)
		print(path, "v1", type(rows), str(rows)[:200])
	except Exception as exc:
		print(path, "v1 FAIL", str(exc)[:120])
	try:
		rows = _make_get_request(f"{REF_BASE_V2}{path}", token, path)
		print(path, "v2", type(rows), str(rows)[:200])
	except Exception as exc:
		print(path, "v2 FAIL", str(exc)[:120])

for hs in ["2710.1210", "2710.1931", "2710.1911", "2710.1921", "2710.1992"]:
	try:
		uoms = _make_get_request(
			f"{REF_BASE_V2}/HS_UOM",
			token,
			"uom",
			params={"hs_code": hs, "annexure_id": 1},
		)
		print("UOM", hs, uoms)
	except Exception as exc:
		print("UOM", hs, str(exc)[:120])


def err(resp):
	vr = resp.get("validationResponse") or {}
	parts = [vr.get("error") or ""]
	for st in vr.get("invoiceStatuses") or []:
		if st.get("error"):
			parts.append(st.get("error"))
	return " | ".join(p for p in parts if p) or str(resp)[:180]


base_item = {
	"quantity": 123,
	"totalValues": 101.43,
	"valueSalesExcludingST": 100,
	"fixedNotifiedValueOrRetailPrice": 0,
	"salesTaxApplicable": 1.43,
	"salesTaxWithheldAtSource": 0,
	"extraTax": 0,
	"furtherTax": 0,
	"fedPayable": 0,
	"discount": 0,
	"saleType": "Petroleum Products",
	"petroleumLevyOn": 123,
}

combos = [
	# Official SRO 1450 rows
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "1"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Motor Spirit", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MOTOR SPIRIT", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Petrol", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1921", "uoM": "Liter", "productDescription": "Light diesel oil", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1921", "uoM": "Liter", "productDescription": "Light diesel oil", "rate": "0.20%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4", "salesTaxApplicable": 0.2, "totalValues": 100.2},
	{"hsCode": "2710.1931", "uoM": "Liter", "productDescription": "High speed diesel oil", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1911", "uoM": "Liter", "productDescription": "Kerosene", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Petroleum Product", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "OTHER", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "4", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1992", "uoM": "Liter", "productDescription": "Other", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "18%", "sroScheduleNo": "", "sroItemSerialNo": "", "salesTaxApplicable": 18, "totalValues": 118},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4", "saleType": "Petroleum Products in Quantity"},
]

payload_base = {
	"invoiceType": "Sale Invoice",
	"invoiceDate": str(doc.invoice_date),
	"sellerNTNCNIC": doc.seller_ntncnic,
	"sellerBusinessName": doc.seller__business_name,
	"sellerProvince": doc.seller_province,
	"sellerAddress": doc.seller_address,
	"buyerNTNCNIC": doc.buyer_ntncnic or "",
	"buyerBusinessName": doc.buyer,
	"buyerProvince": doc.buyer_province,
	"buyerAddress": doc.buyer_address,
	"invoiceRefNo": "",
	"scenarioId": "SN012",
	"buyerRegistrationType": doc.buyer_registration_type,
}

ok = None
for i, extra in enumerate(combos, 1):
	item = dict(base_item)
	item.update(extra)
	payload = dict(payload_base)
	payload["items"] = [item]
	try:
		resp = _make_request(post_url, payload, token)
	except Exception as exc:
		print(f"EXC {i}", extra.get("productDescription"), extra.get("hsCode"), extra.get("sroItemSerialNo"), str(exc)[:160])
		continue
	inv = (resp.get("invoiceNumber") or "").strip()
	if inv:
		print("POSTED", inv, extra)
		ok = (inv, extra, payload)
		break
	print(f"FAIL {i}", extra.get("productDescription"), extra.get("hsCode"), extra.get("serial") or extra.get("sroItemSerialNo"), extra.get("rate"), err(resp)[:180])

if ok:
	inv, extra, payload = ok
	if int(doc.docstatus) == 0 and not doc.fbr_invoice_no:
		doc.fbr_invoice_no = inv
		doc.submit()
		frappe.db.commit()
		print("SUBMITTED", doc.name, inv)
	else:
		print("posted but draft not reusable", doc.name, doc.docstatus, doc.fbr_invoice_no)
else:
	print("still pending after combos")
