// Copyright (c) 2026, kodlyft and contributors
// For license information, please see license.txt

frappe.ui.form.on("HS Code", {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.name) {
			return;
		}
		frm.add_custom_button(__("Refresh UOM from FBR"), () => {
			frappe
				.xcall("di.integrations.reference_api.fetch_hs_code_uom", {
					hs_code: frm.doc.name,
					force: 1
				})
				.then((uom) => {
					if (!uom) {
						frappe.msgprint(__("FBR returned no UOM for this HS Code."));
						return;
					}
					frm.reload_doc();
					frappe.show_alert({ message: __("UOM set to {0}", [uom]), indicator: "green" });
				});
		});
	}
});
