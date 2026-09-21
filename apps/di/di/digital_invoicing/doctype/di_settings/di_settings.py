import frappe
from frappe import _
from frappe.model.document import Document


class DISettings(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		from di.digital_invoicing.doctype.company_sale_type.company_sale_type import CompanySaleType
		from di.digital_invoicing.doctype.company_sandbox_scenario.company_sandbox_scenario import (
			CompanySandboxScenario,
		)

		access_token: DF.Password | None
		address: DF.Data | None
		annexure_id: DF.Data | None
		auto_post_on_submit: DF.Check
		company: DF.Link
		enable_pos_fiscal: DF.Check
		enabled: DF.Check
		ntn_cnic: DF.Data | None
		pos_bearer_token: DF.Password | None
		pos_environment: DF.Literal["Sandbox", "Production"]
		pos_id: DF.Data | None
		province: DF.Link | None
		sale_types: DF.Table[CompanySaleType]
		scenarios: DF.Table[CompanySandboxScenario]
		strn_no: DF.Data | None
		sync_mode: DF.Literal["Production", "Sandbox"]
	# end: auto-generated types

	def validate(self):
		self._validate_duplicate_sale_types()

	def _validate_duplicate_sale_types(self):
		seen = set()
		for row in self.get("sale_types") or []:
			if row.sale_type in seen:
				frappe.throw(_("Duplicate sale type '{0}' in row {1}").format(row.sale_type, row.idx))
			seen.add(row.sale_type)


@frappe.whitelist()
def is_enabled(company):
	"""Check if Digital Invoicing is enabled for the given company."""
	return frappe.db.get_value("DI Settings", {"company": company}, "enabled")


@frappe.whitelist()
def load_fbr_sale_types(company=None, save=1):
	"""Put every official FBR sale type on this company's DI Settings table."""
	frappe.has_permission("DI Settings", "write", throw=True)
	from frappe.utils import cint

	from di.constants import SRO_REQUIRED_SALE_TYPES
	from di.fbr_scenarios import official_sale_types

	company = company or frappe.defaults.get_global_default("company")
	if not company:
		frappe.throw(_("Company is required."))

	names = official_sale_types()
	created_masters = 0
	for name in names:
		if frappe.db.exists("Sale Type", name):
			continue
		frappe.get_doc(
			{
				"doctype": "Sale Type",
				"sale_type_name": name,
				"requires_sro": 1 if name in SRO_REQUIRED_SALE_TYPES else 0,
			}
		).insert(ignore_permissions=True)
		created_masters += 1

	already = []
	added = []
	if cint(save):
		settings_name = frappe.db.get_value("DI Settings", {"company": company}, "name")
		if not settings_name:
			frappe.throw(_("Save DI Settings for {0} first.").format(company))
		doc = frappe.get_doc("DI Settings", settings_name)
		existing = {row.sale_type for row in doc.get("sale_types") or []}
		for name in names:
			if name in existing:
				already.append(name)
				continue
			doc.append("sale_types", {"sale_type": name})
			added.append(name)
			existing.add(name)
		if added:
			doc.save()
	else:
		added = names

	return {
		"company": company,
		"sale_types": names,
		"added": added,
		"already": already,
		"created_masters": created_masters,
	}


def get_settings(company):
	"""Get the DI Settings document for the given company.

	Resolved through the company field rather than by name. The two happen to
	match today because of how records were created, but nothing enforces it and
	renaming a company used to break posting.
	"""
	name = frappe.db.get_value("DI Settings", {"company": company}, "name")
	if not name:
		return None
	return frappe.get_doc("DI Settings", name)
