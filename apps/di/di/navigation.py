import json

import frappe

WORKSPACE_NAME = "Digital Invoicing"
LEARN_URL = "https://docs.kodlyft.com/digital-invoicing/introduction"

NAVIGATION_LINKS = [
	("Client Panels", "Client Panel", "Blue"),
	("Sale Invoices", "Sale Tax Invoice", "Blue"),
	("Buyers", "Buyer", "Green"),
	("Seller / Company", "Seller Or Company", "Grey"),
	("Items", "Tax Item", "Grey"),
	("HS Codes", "HS Code", "Orange"),
	("HS UOMs", "HS Uom", "Orange"),
	("Sale Types", "Sale Type", "Purple"),
	("Transaction Types", "Transaction Type", "Purple"),
	("Scenarios", "Scenario", "Yellow"),
	("Sandbox Scenarios", "Sandbox Scenario", "Yellow"),
	("Provinces", "Province", "Green"),
	("SRO Schedules", "SRO Schedule", "Red"),
	("SRO Items", "SRO Item", "Red"),
	("DI Settings", "DI Settings", "Blue"),
	("DI Logs", "DI Log", "Grey"),
	("DI Error Codes", "DI Error Code", "Grey"),
]

# Desk pages shipped by this app, shown right after Home. The AI assistant is a side
# panel with its own launcher on every page head (di/public/js/di_ai_panel.js), so it
# is not listed here; its page route only redirects to the panel.
PAGE_LINKS = []

# DocTypes of the module that are records of the assistant, not something users browse.
HIDDEN_DOCTYPES = {"DI AI Conversation"}


def sync_digital_invoicing_navigation():
	"""Keep the app sidebar/workspace aligned with standalone DI DocTypes."""
	doctypes = set(
		frappe.get_all(
			"DocType",
			filters={"module": "Digital Invoicing", "istable": 0},
			pluck="name",
		)
	)

	links = [link for link in NAVIGATION_LINKS if link[1] in doctypes]
	known_doctypes = {doctype for _label, doctype, _color in links}

	for doctype in sorted(doctypes - known_doctypes - HIDDEN_DOCTYPES):
		links.append((doctype, doctype, "Grey"))

	_sync_workspace(links)
	_sync_workspace_sidebar(links)

	return {"workspace": WORKSPACE_NAME, "links": len(links), "doctypes": [link[1] for link in links]}


def get_digital_invoicing_navigation_status():
	"""Return a compact DB-level check for the DI sidebar/workspace links."""
	standalone_doctypes = sorted(
		frappe.get_all(
			"DocType",
			filters={"module": "Digital Invoicing", "istable": 0},
			pluck="name",
		)
	)
	child_tables = sorted(
		frappe.get_all(
			"DocType",
			filters={"module": "Digital Invoicing", "istable": 1},
			pluck="name",
		)
	)
	sidebar_links = _get_linked_doctypes("Workspace Sidebar Item")
	workspace_links = _get_linked_doctypes("Workspace Shortcut")

	return {
		"standalone_doctypes": standalone_doctypes,
		"child_tables": child_tables,
		"sidebar_links": sidebar_links,
		"workspace_links": workspace_links,
		"missing_from_sidebar": sorted(set(standalone_doctypes) - set(sidebar_links)),
		"missing_from_workspace": sorted(set(standalone_doctypes) - set(workspace_links)),
	}


def _sync_workspace(links):
	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return

	workspace = frappe.get_doc("Workspace", WORKSPACE_NAME)
	workspace.type = "Workspace"
	workspace.set("shortcuts", [])

	content = [
		{
			"id": "di_header",
			"type": "header",
			"data": {"text": '<span class="h4">DIGITAL INVOICING</span>', "col": 12},
		}
	]

	for index, (label, page, color) in enumerate(_existing_pages(), start=1):
		workspace.append(
			"shortcuts",
			{"color": color, "label": label, "link_to": page, "stats_filter": "[]", "type": "Page"},
		)
		content.append(
			{"id": f"di_page_{index:02d}", "type": "shortcut", "data": {"shortcut_name": label, "col": 3}}
		)

	for index, (label, doctype, color) in enumerate(links, start=1):
		workspace.append(
			"shortcuts",
			{
				"color": color,
				"doc_view": "List",
				"label": label,
				"link_to": doctype,
				"stats_filter": "[]",
				"type": "DocType",
			},
		)
		content.append(
			{
				"id": f"di_shortcut_{index:02d}",
				"type": "shortcut",
				"data": {"shortcut_name": label, "col": 3},
			}
		)

	workspace.content = json.dumps(content, separators=(",", ":"))
	workspace.save(ignore_permissions=True)


def _get_linked_doctypes(child_doctype):
	type_field = "type" if child_doctype == "Workspace Shortcut" else "link_type"
	rows = frappe.get_all(
		child_doctype,
		filters={"parent": WORKSPACE_NAME, type_field: "DocType"},
		fields=["link_to"],
		order_by="idx asc",
	)
	return [row.link_to for row in rows if row.link_to]


def _sync_workspace_sidebar(links):
	if frappe.db.exists("Workspace Sidebar", WORKSPACE_NAME):
		sidebar = frappe.get_doc("Workspace Sidebar", WORKSPACE_NAME)
	else:
		sidebar = frappe.get_doc(
			{
				"doctype": "Workspace Sidebar",
				"name": WORKSPACE_NAME,
				"title": WORKSPACE_NAME,
				"app": "di",
				"module": "Digital Invoicing",
				"standard": 1,
				"header_icon": "organization",
			}
		)

	sidebar.set("items", [])
	sidebar.append("items", _sidebar_item("Home", WORKSPACE_NAME, "Workspace"))
	for label, page, _color in _existing_pages():
		sidebar.append("items", _sidebar_item(label, page, "Page"))
	sidebar.append("items", _sidebar_item("Learn Digital Invoicing", "", "URL", LEARN_URL))

	for label, doctype, _color in links:
		sidebar.append("items", _sidebar_item(label, doctype, "DocType"))

	sidebar.save(ignore_permissions=True)


def _existing_pages():
	"""PAGE_LINKS whose Page record exists on this site (it appears after migrate)."""
	return [(label, page, color) for label, page, color in PAGE_LINKS if frappe.db.exists("Page", page)]


def _sidebar_item(label, link_to, link_type, url=None):
	item = {
		"child": 0,
		"collapsible": 1,
		"indent": 0,
		"keep_closed": 0,
		"label": label,
		"link_to": link_to,
		"link_type": link_type,
		"show_arrow": 0,
		"type": "Link",
	}
	if url:
		item["url"] = url
	return item
