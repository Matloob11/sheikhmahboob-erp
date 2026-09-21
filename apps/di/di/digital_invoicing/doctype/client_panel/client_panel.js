frappe.ui.form.on("Client Panel", {
	refresh(frm) {
		if (frm.is_new()) {
			return;
		}
		frm.add_custom_button(__("Download Welcome PDF"), () => {
			frm.print_doc();
		});
		frm.add_custom_button(__("Reset Password"), () => {
			frappe.confirm(
				__("Generate a new password? The old one will stop working. Download the Welcome PDF again after this."),
				() => {
					frm.call("reset_welcome_password").then(() => {
						frm.reload_doc();
						frappe.show_alert({ message: __("Password updated. Download the Welcome PDF."), indicator: "green" });
					});
				}
			);
		});
	},

	mode(frm) {
		if (frm.doc.mode === "Single Client" && (frm.doc.assigned_sellers || []).length > 1) {
			frappe.msgprint(__("Single Client mode allows only one assigned Seller / Company."));
		}
	}
});
