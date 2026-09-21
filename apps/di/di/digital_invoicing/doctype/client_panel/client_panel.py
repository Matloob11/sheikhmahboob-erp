import frappe
from frappe import _
from frappe.model.document import Document

from di.panel import (
	generate_panel_password,
	get_login_url,
	provision_panel_user,
	set_user_password,
	single_client_assignment_ok,
	sync_assigned_seller_permissions,
)


class ClientPanel(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from di.digital_invoicing.doctype.client_panel_seller.client_panel_seller import ClientPanelSeller

		assigned_sellers: DF.Table[ClientPanelSeller]
		disabled: DF.Check
		email: DF.Data
		full_name: DF.Data
		login_url: DF.Data | None
		mode: DF.Literal["Single Client", "Multi Client"]
		user: DF.Link | None
		welcome_password: DF.Password | None
	# end: auto-generated types

	def get_welcome_password(self) -> str:
		if not self.get("welcome_password"):
			return ""
		return self.get_password("welcome_password") or ""

	def assigned_seller_names(self) -> list[str]:
		return [row.seller for row in self.assigned_sellers if row.seller]

	def validate(self):
		self.email = (self.email or "").strip().lower()
		self.full_name = (self.full_name or "").strip()
		self.login_url = get_login_url()
		self._validate_email()
		self._validate_assignments()

	def before_insert(self):
		self.welcome_password = generate_panel_password()

	def after_insert(self):
		provision_panel_user(self)
		sync_assigned_seller_permissions(self.email, set(), set(self.assigned_seller_names()))

	def on_update(self):
		provision_panel_user(self)
		before = self.get_doc_before_save()
		previous = set(before.assigned_seller_names()) if before else set()
		sync_assigned_seller_permissions(self.email, previous, set(self.assigned_seller_names()))

	def on_trash(self):
		sync_assigned_seller_permissions(self.email, set(self.assigned_seller_names()), set())
		if self.email and frappe.db.exists("User", self.email):
			frappe.db.set_value("User", self.email, "enabled", 0)

	def _validate_email(self):
		if self.email in {"administrator", "guest"}:
			frappe.throw(_("Cannot create a Client Panel for {0}.").format(self.email))
		if self.is_new() and frappe.db.exists("User", self.email):
			from di.panel import is_panel_user

			if not is_panel_user(self.email):
				frappe.throw(_("User {0} already exists.").format(self.email))

	def _validate_assignments(self):
		names = self.assigned_seller_names()
		if len(names) != len(set(names)):
			frappe.throw(_("The same Seller / Company cannot be assigned twice."))
		if self.mode == "Single Client" and not single_client_assignment_ok(names):
			frappe.throw(_("Single Client mode can assign at most one Seller / Company."))

	@frappe.whitelist()
	def reset_welcome_password(self):
		self.check_permission("write")
		password = generate_panel_password()
		self.welcome_password = password
		self.save()
		set_user_password(self.email, password)
		return {"ok": 1}
