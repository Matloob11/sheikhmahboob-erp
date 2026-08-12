"""Run the app's tests with a site bound, without Frappe's test framework.

`bench run-tests` needs `allow_tests` on the site, and it creates and deletes
records — not something to switch on for a site that files real tax invoices.
This binds a site so the tests that need one can run, and touches nothing.

    cd sites && ../env/bin/python ../apps/di/di/tests/run.py <site>

Without a site argument the site-dependent tests skip and the rest still run.
"""

import sys
import unittest
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_ROOT))


def main():
	site = sys.argv[1] if len(sys.argv) > 1 else None

	if site:
		import frappe

		frappe.init(site=site)
		frappe.connect()

	loader = unittest.TestLoader()
	suite = loader.discover(str(Path(__file__).parent), top_level_dir=str(APP_ROOT))
	result = unittest.TextTestRunner(verbosity=2).run(suite)

	if site:
		import frappe

		frappe.destroy()

	return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
	raise SystemExit(main())
