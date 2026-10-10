"""Remove Version rows that still hold plaintext FBR/POS tokens.

Seller Or Company and DI Settings used plain Data token fields until
``move_seller_tokens_to_password``. ``track_changes`` wrote every edit into
``tabVersion``, including the migration itself. New deploys run this once.
"""

import frappe


def execute():
	frappe.db.sql(
		"""
		DELETE FROM `tabVersion`
		WHERE ref_doctype IN ('Seller Or Company', 'DI Settings')
			AND (
				data LIKE '%%sandbox_token%%'
				OR data LIKE '%%production_token%%'
				OR data LIKE '%%access_token%%'
				OR data LIKE '%%pos_bearer_token%%'
			)
		"""
	)
