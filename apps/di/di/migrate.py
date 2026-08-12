from di.custom_fields import setup_custom_fields
from di.navigation import sync_digital_invoicing_navigation
from di.seed_data import (
	seed_di_error_codes,
	seed_hs_codes,
	seed_hs_uoms,
	seed_sandbox_scenarios_from_scenarios,
)


def after_migrate():
	setup_custom_fields()
	seed_hs_uoms()
	seed_hs_codes()
	seed_sandbox_scenarios_from_scenarios()
	seed_di_error_codes()
	sync_digital_invoicing_navigation()
