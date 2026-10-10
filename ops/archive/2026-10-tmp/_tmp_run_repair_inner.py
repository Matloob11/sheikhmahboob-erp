import frappe

frappe.init(site="sheikhmahboob.com")
frappe.connect()
exec(open("/tmp/repair_panel_perms.py", encoding="utf-8").read())
frappe.destroy()
