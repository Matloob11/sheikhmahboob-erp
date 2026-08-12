import frappe

def check():
	frappe.connect("sheikhmahboob.com")
	print("WORKSPACE SIDEBAR HEADER_ICON:", frappe.db.get_value("Workspace Sidebar", "Digital Invoicing", "header_icon"))
	print("DESKTOP ICON:", frappe.db.get_value("Desktop Icon", "Digital Invoicing", ["icon", "logo_url"]))
