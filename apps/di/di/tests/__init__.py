"""Shared site-less test helpers for the di suite."""

from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch


@contextmanager
def scoped_user(*, panel: bool = True, demo: bool = False, user: str = "panel@example.com"):
	"""Patch both panel and demo predicates for site-less scoped-permission tests.

	``is_scoped_seller_user`` / ``has_seller_scoped_permission`` call both
	``di.panel.is_panel_user`` and ``di.demo.is_demo_viewer``; each touches
	``frappe.get_roles`` / ``frappe.session``, which raise without a site.
	"""
	with (
		patch("di.panel.is_panel_user", return_value=panel),
		patch("di.demo.is_demo_viewer", return_value=demo),
		patch("di.panel.frappe.session", SimpleNamespace(user=user)),
	):
		yield
