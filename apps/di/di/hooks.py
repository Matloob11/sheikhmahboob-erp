app_name = "di"
app_title = "Digital Invoicing"
app_publisher = "kodlyft"
app_description = "FBR Digital Invoicing & POS Fiscal Integration for ERPNext"
app_email = "hello@kodlyft.com"
app_license = "mit"

# Apps
# ------------------

required_apps = ["erpnext"]

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "di",
		"logo": "/assets/di/images/smc-mark.svg",
		"title": "Digital Invoicing",
		"route": "/desk/digital-invoicing",
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "/assets/di/css/di_ai_panel.css?v=2026101001"
app_include_js = [
	"/assets/di/js/desk_sidebar_fix.js?v=20260812",
	"/assets/di/js/doctype/tax_item_quick_entry.js?v=20260605",
	"/assets/di/js/di_ai_panel.js?v=2026101001",
]

# include js, css files in header of web template
# web_include_css = "/assets/di/css/di.css"
# web_include_js = "/assets/di/js/di.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "di/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Sales Invoice": "public/js/doctype/sales_invoice.js",
	"Purchase Invoice": "public/js/doctype/purchase_invoice.js",
	"Item": "public/js/doctype/item.js",
	"POS Profile": "public/js/doctype/pos_profile.js",
}
# No doctype_list_js entries: HS Code and Tax Item are this app's own doctypes,
# so Frappe already auto-loads digital_invoicing/doctype/<name>/<name>_list.js.
# Listing them here loaded the same script a second time on the list view, which
# ran frappe.listview_settings assignment and the Quick Entry patch twice.
# doctype_list_js = {}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

standard_queries = {
	"HS Uom": "di.api.search_hs_uoms",
}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "di/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

role_home_page = {
	"DI Panel User": "digital-invoicing",
	"DI Demo Viewer": "digital-invoicing",
}

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
jinja = {
	"methods": [
		"di.integrations.qr_code.generate_qr_code",
		"di.integrations.qr_code.get_fbr_logo_data_uri",
		"di.integrations.di_api._get_taxes",
	]
}

# Installation
# ------------

# before_install = "di.install.before_install"
after_install = "di.install.after_install"

# Uninstallation
# ------------

# before_uninstall = "di.uninstall.before_uninstall"
# after_uninstall = "di.uninstall.after_uninstall"

after_migrate = "di.migrate.after_migrate"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "di.utils.before_app_install"
# after_app_install = "di.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "di.utils.before_app_uninstall"
# after_app_uninstall = "di.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "di.notifications.get_notification_config"

# Permissions
# -----------
# Extra filters for Client Panel users. System Manager / other roles are unchanged.

permission_query_conditions = {
	"Seller Or Company": "di.panel.get_seller_permission_query",
	"Buyer": "di.panel.get_buyer_permission_query",
	"Tax Item": "di.panel.get_tax_item_permission_query",
	"Sale Tax Invoice": "di.panel.get_invoice_permission_query",
}

has_permission = {
	"Seller Or Company": "di.panel.has_seller_scoped_permission",
	"Buyer": "di.panel.has_seller_scoped_permission",
	"Tax Item": "di.panel.has_seller_scoped_permission",
	"Sale Tax Invoice": "di.panel.has_seller_scoped_permission",
}

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
# 	"ToDo": "custom_app.overrides.CustomToDo"
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	"Sales Invoice": {
		"before_validate": "di.events.sales_invoice.before_validate",
		"before_submit": "di.events.sales_invoice.before_submit",
	},
	"Purchase Invoice": {
		"before_submit": "di.events.purchase_invoice.before_submit",
	},
	"Item": {
		"before_save": "di.events.item.before_save",
	},
	"Company": {
		"before_save": "di.events.company.before_save",
	},
	"Buyer": {
		"before_save": "di.panel.apply_default_seller_on_buyer",
	},
	"Tax Item": {
		"before_save": "di.panel.apply_default_seller_on_tax_item",
	},
	"Sale Tax Invoice": {
		"before_validate": "di.panel.apply_default_seller_on_invoice",
	},
}

# Scheduled Tasks
# ---------------

# Reports submitted invoices that never got an FBR number. It does not re-send
# them: after a lost reply we cannot tell whether FBR already holds the invoice,
# and filing the same sale twice cannot be undone. Connection failures — the one
# case where nothing was sent — are retried inside di.integrations.http instead.
scheduler_events = {
	"hourly": [
		"di.tasks.alert_unposted_invoices",
	],
	"daily": [
		"di.demo.rotate_demo_password_if_due",
	],
}

# Testing
# -------

# before_tests = "di.install.before_tests"

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "di.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "di.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["di.utils.before_request"]
# after_request = ["di.utils.after_request"]

# Job Events
# ----------
# before_job = ["di.utils.before_job"]
# after_job = ["di.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"di.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
export_python_type_annotations = True

# DI Log stores the full request and response body of every FBR call, so the
# table grows without bound if left alone. Frappe's daily log clearing job trims
# it to this many days.
default_log_clearing_doctypes = {
	"DI Log": 90,
}

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []
