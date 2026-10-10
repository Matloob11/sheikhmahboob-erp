from di.constants import DI_BASE_URL, DI_POST_SANDBOX
from di.integrations.di_api import _make_request
from di.integrations.sale_tax_invoice_api import _get_seller_token

frappe.set_user("Administrator")

doc = frappe.get_doc("Sale Tax Invoice", "STI-0083")
token = _get_seller_token(doc)
post_url = f"{DI_BASE_URL}{DI_POST_SANDBOX}"
print("token_len", len(token or ""), "buyer", doc.buyer, "reg", doc.buyer_registration_type)


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
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "1"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MS (Petrol)", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Motor Spirit", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "MOTOR SPIRIT", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Petrol", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1921", "uoM": "Liter", "productDescription": "Light diesel oil", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1921", "uoM": "Liter", "productDescription": "Light diesel oil", "rate": "0.20%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4", "salesTaxApplicable": 0.2, "totalValues": 100.2},
	{"hsCode": "2710.1931", "uoM": "Liter", "productDescription": "High speed diesel oil", "rate": "6.75%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "2", "salesTaxApplicable": 6.75, "totalValues": 106.75},
	{"hsCode": "2710.1911", "uoM": "KG", "productDescription": "Kerosene", "rate": "6.70%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "3", "salesTaxApplicable": 6.7, "totalValues": 106.7},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Petroleum Product", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "Petroleum Products", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1210", "uoM": "Liter", "productDescription": "OTHER", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
	{"hsCode": "2710.1992", "uoM": "KG", "productDescription": "Other", "rate": "1.43%", "sroScheduleNo": "1450(I)/2021", "sroItemSerialNo": "4"},
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
		print(f"EXC {i}", extra.get("productDescription"), extra.get("hsCode"), extra.get("sroItemSerialNo"), str(exc)[:180])
		continue
	inv = (resp.get("invoiceNumber") or "").strip()
	if inv:
		print("POSTED", inv, extra)
		ok = (inv, extra, payload)
		break
	print(
		f"FAIL {i}",
		extra.get("productDescription"),
		extra.get("hsCode"),
		extra.get("sroItemSerialNo"),
		extra.get("rate"),
		err(resp)[:200],
	)

if ok:
	inv, extra, payload = ok
	if int(doc.docstatus) == 0 and not doc.fbr_invoice_no:
		doc.fbr_invoice_no = inv
		doc.submit()
		frappe.db.commit()
		print("SUBMITTED", doc.name, inv)
	else:
		print("posted raw", inv)
else:
	print("still pending after combos")
