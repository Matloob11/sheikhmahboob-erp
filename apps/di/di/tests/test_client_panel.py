"""Client Panel helpers: isolation, password, welcome PDF fields.

Site-bound tests skip unless run.py is given a site. They do not create users
or invoices — this runner is safe to point at a live tax site.
"""

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from di.panel import (
	generate_panel_password,
	get_buyer_permission_query,
	get_invoice_permission_query,
	get_seller_permission_query,
	get_tax_item_permission_query,
	has_seller_scoped_permission,
	single_client_assignment_ok,
)

WELCOME_HTML = (
	Path(__file__).resolve().parents[1]
	/ "digital_invoicing"
	/ "print_format"
	/ "client_panel_welcome"
	/ "client_panel_welcome.html"
)


class FakeDoc(SimpleNamespace):
	def get(self, key, default=None):
		return getattr(self, key, default)

	def is_new(self):
		return bool(getattr(self, "_is_new", False))


class FakeDB:
	@staticmethod
	def escape(value):
		return "'" + str(value).replace("'", "''") + "'"


class TestPanelPasswordAndMode(unittest.TestCase):
	def test_generated_password_is_mixed(self):
		for _ in range(15):
			password = generate_panel_password()
			self.assertGreaterEqual(len(password), 10)
			self.assertTrue(any(c.islower() for c in password))
			self.assertTrue(any(c.isupper() for c in password))
			self.assertTrue(any(c.isdigit() for c in password))
			self.assertTrue(password.isalnum())

	def test_single_client_allows_zero_or_one_seller(self):
		self.assertTrue(single_client_assignment_ok([]))
		self.assertTrue(single_client_assignment_ok(["Acme"]))
		self.assertFalse(single_client_assignment_ok(["Acme", "Beta"]))

	def test_welcome_pdf_lists_login_password_and_mode(self):
		html = WELCOME_HTML.read_text(encoding="utf-8")
		self.assertIn("doc.login_url", html)
		self.assertIn("doc.email", html)
		self.assertIn("get_welcome_password", html)
		self.assertIn("doc.mode", html)
		self.assertIn("assigned_seller_names", html)
		self.assertIn("Login URL", html)
		self.assertIn("Sheikh Mahboob", html)
		self.assertIn("cp-welcome", html)


class TestPanelIsolation(unittest.TestCase):
	def test_empty_seller_list_sees_no_rows(self):
		with patch("di.panel.is_panel_user", return_value=True), patch(
			"di.panel.get_allowed_sellers", return_value=[]
		):
			self.assertEqual(get_invoice_permission_query(), "1=0")
			self.assertEqual(get_buyer_permission_query(), "1=0")
			self.assertEqual(get_tax_item_permission_query(), "1=0")
			self.assertEqual(get_seller_permission_query(), "1=0")

	def test_query_limits_invoices_to_assigned_seller(self):
		with (
			patch("di.panel.is_panel_user", return_value=True),
			patch("di.panel.get_allowed_sellers", return_value=["Acme"]),
			patch("di.panel.frappe.db", FakeDB),
		):
			query = get_invoice_permission_query()
			self.assertIn("`tabSale Tax Invoice`.`seller__business_name`", query)
			self.assertIn("'Acme'", query)
			self.assertNotIn("Other Co", query)

	def test_non_panel_user_is_not_filtered(self):
		with patch("di.panel.is_panel_user", return_value=False):
			self.assertIsNone(get_invoice_permission_query())
			self.assertIsNone(get_seller_permission_query())

	def test_panel_user_cannot_read_someone_elses_invoice(self):
		other = FakeDoc(doctype="Sale Tax Invoice", seller__business_name="Other Co")
		own = FakeDoc(doctype="Sale Tax Invoice", seller__business_name="Acme")
		blank = FakeDoc(doctype="Sale Tax Invoice", seller__business_name=None)
		with patch("di.panel.is_panel_user", return_value=True), patch(
			"di.panel.get_allowed_sellers", return_value=["Acme"]
		):
			self.assertTrue(has_seller_scoped_permission(own, "read"))
			self.assertFalse(has_seller_scoped_permission(other, "read"))
			self.assertFalse(has_seller_scoped_permission(other, None))
			self.assertFalse(has_seller_scoped_permission(blank, "read"))

	def test_admin_can_read_any_invoice(self):
		other = FakeDoc(doctype="Sale Tax Invoice", seller__business_name="Other Co")
		with patch("di.panel.is_panel_user", return_value=False):
			self.assertTrue(has_seller_scoped_permission(other, "read"))

	def test_single_client_cannot_create_a_second_seller(self):
		from di.panel import enforce_single_client_seller_cap

		seller = FakeDoc(_is_new=True)
		with (
			patch("di.panel.is_panel_user", return_value=True),
			patch("di.panel.get_client_panel_name", return_value="panel@example.com"),
			patch("di.panel.get_allowed_sellers", return_value=["Acme"]),
			patch("di.panel.frappe.db.get_value", return_value="Single Client"),
			patch("di.panel.frappe.throw", side_effect=RuntimeError("capped")),
		):
			with self.assertRaises(RuntimeError):
				enforce_single_client_seller_cap(seller)

	def test_multi_client_can_create_another_seller(self):
		from di.panel import enforce_single_client_seller_cap

		seller = FakeDoc(_is_new=True)
		with (
			patch("di.panel.is_panel_user", return_value=True),
			patch("di.panel.get_client_panel_name", return_value="panel@example.com"),
			patch("di.panel.get_allowed_sellers", return_value=["Acme"]),
			patch("di.panel.frappe.db.get_value", return_value="Multi Client"),
			patch("di.panel.frappe.throw", side_effect=RuntimeError("capped")),
		):
			enforce_single_client_seller_cap(seller)

	def test_new_seller_write_is_allowed_before_permission_row(self):
		seller = FakeDoc(doctype="Seller Or Company", name="Brand New", _is_new=True)
		with patch("di.panel.is_panel_user", return_value=True), patch(
			"di.panel.get_allowed_sellers", return_value=[]
		):
			self.assertTrue(has_seller_scoped_permission(seller, "write"))

	def test_buyer_query_includes_assigned_seller_and_shared_unregistered(self):
		with (
			patch("di.panel.is_panel_user", return_value=True),
			patch("di.panel.get_allowed_sellers", return_value=["Acme"]),
			patch("di.panel.frappe.db", FakeDB),
		):
			query = get_buyer_permission_query()
			self.assertIn("`tabBuyer`.`seller` in ('Acme')", query)
			self.assertIn("buyer_registration_type", query)
			self.assertIn("Unregistered", query)

	def test_panel_user_can_read_shared_unregistered_buyer_only(self):
		walk_in = FakeDoc(doctype="Buyer", seller=None, buyer_registration_type="Unregistered")
		blank_registered = FakeDoc(doctype="Buyer", seller=None, buyer_registration_type="Registered")
		other = FakeDoc(doctype="Buyer", seller="Other Co", buyer_registration_type="Unregistered")
		own = FakeDoc(doctype="Buyer", seller="Acme", buyer_registration_type="Registered")
		with patch("di.panel.is_panel_user", return_value=True), patch(
			"di.panel.get_allowed_sellers", return_value=["Acme"]
		):
			self.assertTrue(has_seller_scoped_permission(walk_in, "read"))
			self.assertFalse(has_seller_scoped_permission(blank_registered, "read"))
			self.assertFalse(has_seller_scoped_permission(other, "read"))
			self.assertTrue(has_seller_scoped_permission(own, "read"))

	def test_allowed_sellers_include_panel_assignment_without_user_permission(self):
		from di.panel import get_allowed_sellers

		def fake_get_all(doctype, **kwargs):
			if doctype == "Client Panel Seller":
				self.assertEqual(kwargs["filters"]["parent"], "client@example.com")
				self.assertEqual(kwargs["filters"]["parenttype"], "Client Panel")
				return ["Acme"]
			if doctype == "User Permission":
				return []
			return []

		with (
			patch("di.panel.frappe.get_all", side_effect=fake_get_all),
			patch("di.panel.frappe.session", SimpleNamespace(user="Administrator")),
		):
			self.assertEqual(get_allowed_sellers("client@example.com"), ["Acme"])

	def test_allowed_sellers_union_assignment_and_self_created(self):
		from di.panel import get_allowed_sellers

		def fake_get_all(doctype, **kwargs):
			if doctype == "Client Panel Seller":
				return ["Acme"]
			if doctype == "User Permission":
				return ["Self Co"]
			return []

		with patch("di.panel.frappe.get_all", side_effect=fake_get_all):
			self.assertEqual(get_allowed_sellers("client@example.com"), ["Acme", "Self Co"])

	def test_sync_always_ensures_current_assignment(self):
		from di.panel import sync_assigned_seller_permissions

		with (
			patch("di.panel.ensure_user_permission") as ensure,
			patch("di.panel.provision_assigned_seller") as provision,
			patch("di.panel.remove_user_permission") as remove,
		):
			sync_assigned_seller_permissions("client@example.com", {"Acme"}, {"Acme"})
			ensure.assert_called_once_with("client@example.com", "Acme")
			provision.assert_called_once_with("Acme")
			remove.assert_not_called()


class _PermRow:
	def __init__(self, role, permlevel=0, **rights):
		self.role = role
		self.permlevel = permlevel
		self._rights = rights

	def get(self, key, default=None):
		if key in self._rights:
			return self._rights[key]
		return getattr(self, key, default)


class TestPanelCustomDocPermRepair(unittest.TestCase):
	def test_gap_fill_skips_when_no_custom_perms(self):
		from di.panel import fill_custom_docperm_gaps_from_docperm

		with patch("di.panel.frappe.db.exists", return_value=False):
			self.assertEqual(fill_custom_docperm_gaps_from_docperm("HS Code"), 0)

	def test_gap_fill_copies_missing_docperm_roles(self):
		from di.panel import fill_custom_docperm_gaps_from_docperm

		inserted = []

		def fake_get_all(doctype, **kwargs):
			if doctype == "Custom DocPerm":
				return [_PermRow("DI Demo Viewer")]
			if doctype == "DocPerm":
				return [
					_PermRow("All", read=1, select=1, report=1),
					_PermRow("DI Demo Viewer", read=1),
				]
			return []

		class FakeDoc:
			def insert(self, **kwargs):
				inserted.append(kwargs)

		with (
			patch("di.panel.frappe.db.exists", return_value=True),
			patch("di.panel.frappe.get_all", side_effect=fake_get_all),
			patch("di.panel.frappe.get_doc", side_effect=lambda *a, **k: FakeDoc()),
		):
			added = fill_custom_docperm_gaps_from_docperm("HS Code")

		self.assertEqual(added, 1)
		self.assertEqual(len(inserted), 1)

	def test_ensure_panel_perms_upserts_when_custom_mode(self):
		from di.panel import ensure_di_panel_permissions

		upserts = []

		with (
			patch("di.panel.ensure_di_panel_role"),
			patch("di.panel.frappe.get_all", return_value=[]),
			patch("di.panel.frappe.db.exists", return_value=True),
			patch("di.panel.fill_custom_docperm_gaps_from_docperm", return_value=2),
			patch("di.panel._doctype_has_custom_perms", return_value=True),
			patch(
				"di.panel.upsert_custom_docperm",
				side_effect=lambda dt, role, values, permlevel=0: upserts.append((dt, role)),
			),
			patch("di.panel.frappe.clear_cache"),
		):
			result = ensure_di_panel_permissions()

		self.assertGreater(result["gaps_filled"], 0)
		self.assertIn(("Sale Tax Invoice", "DI Panel User"), upserts)
		self.assertIn(("HS Code", "DI Panel User"), upserts)
		self.assertIn("Sale Tax Invoice", result["panel_perms_ensured"])
		self.assertIn("HS Code", result["panel_perms_ensured"])
