"""Drop SRO Item rows with no schedule — they were never usable for lookups."""

import frappe


def execute():
	count = frappe.db.count("SRO Item", {"sro_schedule": ("in", ("", None))})
	if not count:
		return
	frappe.db.delete("SRO Item", {"sro_schedule": ("in", ("", None))})
	frappe.db.commit()
	frappe.logger().info(f"Deleted {count} SRO Item rows with blank sro_schedule")
