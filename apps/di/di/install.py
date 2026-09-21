import frappe

from di.custom_fields import setup_custom_fields
from di.navigation import sync_digital_invoicing_navigation
from di.panel import ensure_di_panel_role
from di.seed_data import (
	seed_di_error_codes,
	seed_fbr_scenarios,
	seed_hs_codes,
	seed_hs_uoms,
	seed_sandbox_scenarios_from_scenarios,
)


def after_install():
	setup_custom_fields()
	ensure_di_panel_role()
	seed_hs_uoms()
	seed_hs_codes()
	seed_fbr_scenarios()
	seed_sandbox_scenarios_from_scenarios()
	seed_di_error_codes()
	sync_digital_invoicing_navigation()
