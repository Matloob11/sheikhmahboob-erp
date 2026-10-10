// Copyright (c) 2026, kodlyft and Contributors
// For license information, please see license.txt

frappe.ui.form.on("Buyer", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}
		frm.add_custom_button(__("Verify with FBR"), () => {
			frappe
				.xcall("di.digital_invoicing.doctype.buyer.buyer.verify_buyer_with_fbr", {
					buyer: frm.doc.name
				})
				.then((r) => {
					frm.reload_doc();
					frappe.show_alert({
						message: __("FBR status: {0}", [(r && r.fbr_registration_status) || "?"]),
						indicator: "blue"
					});
				});
		});
	}
});
