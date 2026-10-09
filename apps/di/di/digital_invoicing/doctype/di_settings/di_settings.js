frappe.ui.form.on("DI Settings", {
	refresh(frm) {
		if (!frm.is_new()) {
			di_settings_add_sync_buttons(frm);
			di_settings_add_setup_check(frm);
			di_settings_add_sandbox_drafts(frm);
		}
		if (frm.doc.company) {
			di_settings_add_sale_types(frm);
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

function di_settings_add_sale_types(frm) {
	frm.add_custom_button(__("Load FBR sale types"), () => {
		if (!frm.doc.company) {
			frappe.msgprint(__("Set Company first."));
			return;
		}
		frappe
			.xcall("di.api.load_fbr_sale_types", {
				company: frm.doc.company,
				save: frm.is_new() ? 0 : 1,
			})
			.then((result) => {
				let added = result.added || [];
				if (frm.is_new()) {
					let have = new Set((frm.doc.sale_types || []).map((row) => row.sale_type));
					(result.sale_types || []).forEach((name) => {
						if (have.has(name)) return;
						let child = frm.add_child("sale_types");
						child.sale_type = name;
						have.add(name);
					});
					frm.refresh_field("sale_types");
				} else {
					frm.reload_doc();
				}
				frappe.show_alert({
					message: added.length
						? __("Added {0} FBR sale type(s)", [added.length])
						: __("All FBR sale types are already on this company"),
					indicator: "green",
				});
			});
	});
}

function di_settings_add_sandbox_drafts(frm) {
	frm.add_custom_button(__("Pending invoices → Submit"), () => {
		frappe
			.xcall("di.api.get_sandbox_pending_scenarios", { company: frm.doc.company })
			.then((data) => {
				if (data.environment === "Invalid") {
					frappe.msgprint({
						title: __("Pending invoices"),
						indicator: "red",
						message: data.message,
					});
					return;
				}
				if (data.environment === "Production") {
					frappe.msgprint({
						title: __("Pending invoices"),
						indicator: "orange",
						message: data.message,
					});
					return;
				}
				show_sandbox_draft_dialog(frm, data);
			});
	}, __("Sync Reference Data"));
}

function show_sandbox_draft_dialog(frm, data) {
	let rows = (data.scenarios || [])
		.map((row) => {
			let checked = row.create_by_default ? "checked" : "";
			let disabled = row.status === "posted" ? "disabled" : "";
			let tag =
				row.status === "posted"
					? __("Already successful here")
					: row.status === "draft"
						? __("Draft — will submit")
						: row.status === "not_assigned"
							? __("Not on this FBR account")
							: __("Pending");
			return `<tr>
				<td style="width:36px;">
					<input type="checkbox" class="di-sandbox-sn" data-sn="${frappe.utils.escape_html(row.scenario_id)}" ${checked} ${disabled}>
				</td>
				<td><b>${frappe.utils.escape_html(row.scenario_id)}</b></td>
				<td>${frappe.utils.escape_html(row.description)}</td>
				<td class="text-muted">${frappe.utils.escape_html(tag)}</td>
			</tr>`;
		})
		.join("");

	let dialog = new frappe.ui.Dialog({
		title: __("Pending invoices → Submit"),
		size: "large",
		fields: [
			{
				fieldtype: "HTML",
				options: `<p>${frappe.utils.escape_html(data.message)}</p>
					<p class="text-muted">${__("Tick the scenarios you still need. Uncheck any already done in another system. Each selected invoice is posted to FBR on its own request, so the page does not time out. Failed ones are discarded, not left as drafts.")}</p>
					<div style="max-height:420px;overflow:auto;">
						<table class="table table-sm">
							<thead><tr>
								<th></th>
								<th>${__("Scenario")}</th>
								<th>${__("Description")}</th>
								<th>${__("Status")}</th>
							</tr></thead>
							<tbody>${rows}</tbody>
						</table>
					</div>`,
			},
		],
		primary_action_label: __("Validate & submit"),
		primary_action() {
			let ids = [];
			dialog.$wrapper.find(".di-sandbox-sn:checked:not(:disabled)").each(function () {
				ids.push(this.getAttribute("data-sn"));
			});
			if (!ids.length) {
				frappe.msgprint(__("Select at least one pending scenario."));
				return;
			}
			dialog.hide();
			submit_sandbox_scenarios_sequentially(frm, ids);
		},
	});
	dialog.show();
}

function submit_sandbox_scenarios_sequentially(frm, ids) {
	// One scenario per desk request. The gateway closes the connection at 120
	// seconds and the desk shows "Request Timed Out". Several scenarios, and
	// SN017's rate checks, do not fit in that one wait.
	let created = [];
	let skipped = [];
	let errors = [];
	let index = 0;

	function show_result() {
		frappe.dom.unfreeze();
		let created_html = created
			.map((row) => `${row.scenario_id}: ${row.name}${row.fbr_invoice_no ? " — " + row.fbr_invoice_no : ""}`)
			.join("<br>");
		let skipped_html = skipped
			.map((row) => `${row.scenario_id}: ${frappe.utils.escape_html(row.reason)}`)
			.join("<br>");
		let errors_html = errors
			.map((row) => `${row.scenario_id}: ${frappe.utils.escape_html(row.reason)}`)
			.join("<br>");
		frappe.msgprint({
			title: __("Sandbox submit"),
			indicator: errors.length ? "orange" : "green",
			message: `
				<p>${__("Posted to FBR and submitted")}: ${created.length}</p>
				${created_html ? `<p>${created_html}</p>` : ""}
				${skipped_html ? `<p>${__("Skipped")}:<br>${skipped_html}</p>` : ""}
				${errors_html ? `<p>${__("Not submitted — FBR rejected")}:<br>${errors_html}</p>` : ""}
			`,
		});
	}

	function next() {
		if (index >= ids.length) {
			show_result();
			return;
		}
		let sn = ids[index];
		index += 1;
		frappe.dom.freeze(__("Submitting {0} ({1} of {2})...", [sn, index, ids.length]));
		frappe.call({
			method: "di.api.create_sandbox_scenario_drafts",
			args: { company: frm.doc.company, scenario_ids: [sn] },
			callback(r) {
				let result = (r && r.message) || {};
				created = created.concat(result.created || []);
				skipped = skipped.concat(result.skipped || []);
				errors = errors.concat(result.errors || []);
				next();
			},
			error() {
				errors.push({
					scenario_id: sn,
					reason: __(
						"Stopped before FBR answered. Refresh and check this scenario before sending it again."
					),
				});
				next();
			},
		});
	}

	next();
}
