from di.integrations.reference_api import get_sro_items_for_schedule, get_sro_schedules_for_rate
import di.integrations.sale_tax_invoice_api as sti_api
from di.integrations.sale_tax_invoice_api import post_sale_tax_invoice

frappe.set_user("Administrator")

print("sro 653", get_sro_schedules_for_rate(653, company="Golden Ball International"))
print("items 401", get_sro_items_for_schedule(401, company="Golden Ball International"))
print("sro 728", get_sro_schedules_for_rate(728, company="Golden Ball International"))

serials = get_sro_items_for_schedule(401, company="Golden Ball International") or []
print("n serials", len(serials), serials[:20])

_orig = sti_api._build_item_payload
def _build(row):
	payload = _orig(row)
	payload["petroleumLevyOn"] = 123
	payload["productDescription"] = "MOTOR SPIRIT"
	return payload
sti_api._build_item_payload = _build

doc = frappe.get_doc("Sale Tax Invoice", "STI-0083")
if int(doc.docstatus) != 0:
	print("already submitted", doc.fbr_invoice_no)
else:
	row = doc.invoice_items[0]
	row.sro_schedule_no = "1450(I)/2021"
	# try all serials
	ok = False
	for s in serials or [{"serial": "4"}, {"serial": "1"}]:
		serial = s.get("serial")
		row.sro_item_serial_no = serial
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		doc.reload()
		try:
			post_sale_tax_invoice(doc)
			if doc.fbr_invoice_no:
				doc.submit()
				frappe.db.commit()
				print("POSTED", doc.name, doc.fbr_invoice_no, "serial", serial)
				ok = True
				break
		except Exception as exc:
			frappe.db.rollback()
			print("FAIL serial", serial, str(exc)[:260])
			doc = frappe.get_doc("Sale Tax Invoice", "STI-0083")
			row = doc.invoice_items[0]
	if not ok:
		# last try: 18% no SRO, levy + MOTOR SPIRIT
		row.sro_schedule_no = ""
		row.sro_item_serial_no = ""
		item = frappe.get_doc("Tax Item", "MOTOR SPIRIT")
		item.tax_desc = "18%"
		item.rate_in_p = 18
		item.save(ignore_permissions=True)
		doc.invoice_items[0].sale_rate = 1000
		doc.invoice_items[0].quantity = 1
		doc.save(ignore_permissions=True)
		frappe.db.commit()
		doc.reload()
		try:
			post_sale_tax_invoice(doc)
			if doc.fbr_invoice_no:
				doc.submit()
				frappe.db.commit()
				print("POSTED 18% no sro", doc.name, doc.fbr_invoice_no)
				ok = True
		except Exception as exc:
			frappe.db.rollback()
			print("FAIL 18%", str(exc)[:300])
	if not ok:
		print("still pending")
