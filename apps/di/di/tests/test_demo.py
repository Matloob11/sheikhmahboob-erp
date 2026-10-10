"""Read-only demo viewer scoping."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from di.demo import DEMO_EMAIL, DEMO_ROLE, DEMO_SELLER, is_demo_viewer
from di.panel import get_allowed_sellers, get_buyer_permission_query, has_seller_scoped_permission
from di.tests import scoped_user


class FakeDB:
	@staticmethod
	def escape(value):
		return "'" + str(value).replace("'", "''") + "'"


class TestDemoViewer(unittest.TestCase):
	@patch("di.demo.frappe.get_roles", return_value=[DEMO_ROLE])
	def test_demo_role_is_detected(self, _roles):
		self.assertTrue(is_demo_viewer(DEMO_EMAIL))

	@patch("di.demo.frappe.get_roles", return_value=["DI Panel User"])
	def test_panel_user_is_not_demo(self, _roles):
		self.assertFalse(is_demo_viewer("client@example.com"))

	def test_demo_cannot_write(self):
		doc = SimpleNamespace(
			doctype="Sale Tax Invoice",
			seller__business_name=DEMO_SELLER,
			get=lambda k, default=None: DEMO_SELLER if k == "seller__business_name" else default,
		)
		with scoped_user(panel=False, demo=True, user=DEMO_EMAIL), patch(
			"di.panel.get_allowed_sellers", return_value=[DEMO_SELLER]
		):
			self.assertTrue(has_seller_scoped_permission(doc, "read", DEMO_EMAIL))
			self.assertFalse(has_seller_scoped_permission(doc, "write", DEMO_EMAIL))
			self.assertFalse(has_seller_scoped_permission(doc, "create", DEMO_EMAIL))
			self.assertFalse(has_seller_scoped_permission(doc, "submit", DEMO_EMAIL))

	def test_demo_buyers_are_seller_scoped_only(self):
		with (
			scoped_user(panel=False, demo=True, user=DEMO_EMAIL),
			patch("di.panel.get_allowed_sellers", return_value=[DEMO_SELLER]),
			patch("di.panel.frappe.db", FakeDB),
		):
			query = get_buyer_permission_query(DEMO_EMAIL)
			self.assertIn(DEMO_SELLER, query)
			self.assertNotIn("Unregistered", query)

	def test_demo_allowed_sellers_from_user_permission(self):
		with (
			scoped_user(panel=False, demo=True, user=DEMO_EMAIL),
			patch("di.panel.frappe.get_all", return_value=[DEMO_SELLER]),
		):
			self.assertEqual(get_allowed_sellers(DEMO_EMAIL), [DEMO_SELLER])
