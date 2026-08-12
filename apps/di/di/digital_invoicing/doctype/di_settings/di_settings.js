frappe.ui.form.on("DI Settings", {
	refresh(frm) {
		if (!frm.is_new()) {
			di_settings_add_sync_buttons(frm);
			di_settings_add_setup_check(frm);
		}

		frm.toggle_display("pos_id", frm.doc.enable_pos_fiscal);
		frm.toggle_display("pos_bearer_token", frm.doc.enable_pos_fiscal);
		frm.toggle_display("pos_environment", frm.doc.enable_pos_fiscal);

		frm.toggle_display("scenarios", frm.doc.sync_mode === "Sandbox");
	},

	enable_pos_fiscal(frm) {
		frm.toggle_display("pos_id", frm.doc.enable_pos_fiscal);
		frm.toggle_display("pos_bearer_token", frm.doc.enable_pos_fiscal);
		frm.toggle_display("pos_environment", frm.doc.enable_pos_fiscal);
	},

	sync_mode(frm) {
		frm.toggle_display("scenarios", frm.doc.sync_mode === "Sandbox");
	},
});

function di_settings_add_sync_buttons(frm) {
	let sync_types = [
		{ label: __("Sync All Missing Data"), data_type: "all_reference_data" },
		{ label: __("Sync Provinces"), data_type: "provinces" },
		{ label: __("Sync HS Codes"), data_type: "hs_codes" },
		{ label: __("Sync HS Code UOMs"), data_type: "hs_code_uoms" },
		{ label: __("Sync UOMs"), data_type: "uoms" },
		{ label: __("Sync Transaction Types"), data_type: "transaction_types" },
		{ label: __("Sync SRO Item Codes"), data_type: "sro_item_codes" },
		{ label: __("Sync SRO Schedules"), data_type: "sro_schedules" },
		{ label: __("Sync SRO Schedules for Rates"), data_type: "sro_schedules_for_rates" },
	];

	sync_types.forEach(({ label, data_type }) => {
		frm.add_custom_button(label, () => {
			frappe.xcall("di.api.sync_reference_data", {
				data_type: data_type,
				company: frm.doc.company,
			}).then(() => {
				frappe.show_alert({
					message: __("Syncing {0} in background", [data_type]),
					indicator: "blue",
				});
			}).catch((err) => {
				frappe.show_alert({
					message: __("Sync failed: {0}", [err.message || err]),
					indicator: "red",
				});
			});
		}, __("Sync Reference Data"));
	});
}

// Getting Digital Invoicing working means eight unrelated things being right at
// once, and most of them fail late and quietly: a tax row without a Tax Type is
// filed at 0%, an item without an HS UOM is rejected as error 0099, a customer
// carrying the seller's own NTN is refused as self invoicing. This says what is
// missing before an invoice is ever sent.
function di_settings_add_setup_check(frm) {
	frm.add_custom_button(__("Check Setup"), () => {
		frappe
			.xcall("di.api.get_setup_status", { company: frm.doc.company })
			.then((result) => {
				let rows = (result.checks || [])
					.map((check) => {
						let icon = check.ok ? "&#10003;" : "&#10007;";
						let colour = check.ok ? "green" : "red";
						let hint = check.hint
							? `<div class="text-muted small">${frappe.utils.escape_html(check.hint)}</div>`
							: "";
						return `<tr>
							<td style="width:28px;color:${colour};font-size:15px;">${icon}</td>
							<td>${frappe.utils.escape_html(check.label)}${hint}</td>
						</tr>`;
					})
					.join("");

				let failed = (result.checks || []).filter((c) => !c.ok).length;
				let heading = failed
					? __("{0} thing(s) still need attention", [failed])
					: __("Everything needed for FBR posting is in place.");

				frappe.msgprint({
					title: __("Digital Invoicing Setup"),
					indicator: failed ? "orange" : "green",
					message: `<p>${heading}</p><table class="table table-sm">${rows}</table>`,
				});
			});
	});
}
