"""Create the DI Panel User role before DocType permissions reference it."""

from di.panel import ensure_di_panel_role


def execute():
	ensure_di_panel_role()
