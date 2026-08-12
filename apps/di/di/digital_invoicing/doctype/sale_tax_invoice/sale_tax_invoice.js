frappe.ui.form.on("Sale Tax Invoice", {
	refresh(frm) {
		render_qr_code(frm);
		calculate_invoice_totals(frm);
		add_fbr_buttons(frm);
	},

	scenario_id(frm) {
		set_item_sale_type(frm);
	},

	validate(frm) {
		calculate_invoice_totals(frm);
	}
});

frappe.ui.form.on("Sale Tax Invoice Item", {
	description(frm, cdt, cdn) {
		setTimeout(() => calculate_invoice_item(frm, cdt, cdn), 300);
	},
	quantity: calculate_invoice_item,
	sale_rate: calculate_invoice_item,
	tax_rate_value: calculate_invoice_item,
	sales_tax_withheld_at_source: calculate_invoice_item,
	extra_tax: calculate_invoice_item,
	further_tax: calculate_invoice_item,
	fed_payable: calculate_invoice_item,
	discount: calculate_invoice_item
});

function render_qr_code(frm) {
	let qr_data = frm.doc.qr_code_data;
	if (qr_data) {
		frm.fields_dict.qr_code.$wrapper.html(
			`<div style="padding:10px 0 20px 20px;"><img src="${qr_data}" alt="QR Code" style="width:128px;height:128px;"></div>`
		);
		return;
	}

	frm.fields_dict.qr_code.$wrapper.empty();
}

function calculate_invoice_item(frm, cdt, cdn) {
	let row = locals[cdt][cdn];
	let quantity = flt(row.quantity);
	let sale_rate = flt(row.sale_rate);
	let discount = flt(row.discount);
	let tax_rate = flt(row.tax_rate_value);
	let fixed_price = flt(row.fixed_notified_value_or_retail_price);

	let value_sales = Math.max(quantity * sale_rate - discount, 0);
	let tax_base = value_sales;
	if (row.sale_type === "3rd Schedule Goods" && fixed_price) {
		tax_base = quantity ? fixed_price * quantity : fixed_price;
	}
	let sales_tax = tax_base * tax_rate / 100;
	let total_values =
		value_sales +
		sales_tax +
		flt(row.sales_tax_withheld_at_source) +
		flt(row.extra_tax) +
		flt(row.further_tax) +
		flt(row.fed_payable);

	frappe.model.set_value(cdt, cdn, "value_sales_excluding_st", value_sales);
	frappe.model.set_value(cdt, cdn, "sales_tax_applicable", sales_tax);
	frappe.model.set_value(cdt, cdn, "total_values", total_values);
	calculate_invoice_totals(frm);
}

function calculate_invoice_totals(frm) {
	let total_sales = 0;
	let total_taxes = 0;
	let total_sales_with_taxes = 0;

	(frm.doc.invoice_items || []).forEach((row) => {
		let sales = flt(row.value_sales_excluding_st);
		let taxes =
			flt(row.sales_tax_applicable) +
			flt(row.sales_tax_withheld_at_source) +
			flt(row.extra_tax) +
			flt(row.further_tax) +
			flt(row.fed_payable);

		total_sales += sales;
		total_taxes += taxes;
		total_sales_with_taxes += flt(row.total_values) || sales + taxes;
	});

	frm.set_value("total_sales", total_sales);
	frm.set_value("total_taxes", total_taxes);
	frm.set_value("total_sales_with_taxes", total_sales_with_taxes);
}

function set_item_sale_type(frm) {
	if (!frm.doc.scenario_id) return;

	frappe.db.get_value("Scenario", frm.doc.scenario_id, "sale__purchase_type").then((r) => {
		let sale_type = r && r.message && r.message.sale__purchase_type;
		if (!sale_type) return;

		(frm.doc.invoice_items || []).forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, "sale_type", sale_type);
		});
	});
}

// FBR usually leaves validationResponse.error empty and puts the real reason on
// each item in invoiceStatuses, so reporting only the top-level field showed
// "Invalid" with no explanation.
function describe_fbr_errors(vr) {
	let lines = [];
	if (vr.error) lines.push(frappe.utils.escape_html(vr.error));

	(vr.invoiceStatuses || []).forEach((row) => {
		if (row.status === "Valid" || !row.error) return;
		let code = row.errorCode ? `${row.errorCode}: ` : "";
		lines.push(
			__("Item {0} — {1}", [
				row.itemSNo || "?",
				frappe.utils.escape_html(code + row.error)
			])
		);
	});

	if (!lines.length) lines.push(__("FBR reported the invoice as {0}.", [vr.status || "Invalid"]));
	return lines.join("<br><br>");
}

// FBR rejects a non-18% line without an SRO schedule (0077) and rejects a serial
// it does not recognise (0078). Rather than expecting the user to memorise
// strings like "EIGHTH SCHEDULE Table 1" and serial "70", ask FBR what is valid.
async function fill_sro_details(frm) {
	let pending = (frm.doc.invoice_items || []).filter(
		(row) => flt(row.tax_rate_value) !== 18 && !row.sro_schedule_no
	);

	if (!pending.length) {
		frappe.msgprint(__("No rows need an SRO schedule. FBR only requires one when the rate is not 18%."));
		return;
	}

	for (let row of pending) {
		let rate_id = await frappe.db.get_value("Tax Item", row.description, "rate_id");
		rate_id = rate_id && rate_id.message ? rate_id.message.rate_id : null;

		if (!rate_id) {
			frappe.msgprint(
				__("Item {0} has no FBR rate id. Open the Tax Item and fetch its tax rate first.", [
					row.description
				])
			);
			continue;
		}

		let schedules = await frappe.xcall("di.integrations.reference_api.get_sro_schedules_for_rate", {
			rate_id: rate_id
		});

		if (!schedules || !schedules.length) {
			frappe.msgprint(__("FBR returned no SRO schedule for the rate on item {0}.", [row.description]));
			continue;
		}

		let chosen = await pick_option(
			__("SRO Schedule for {0}", [row.description]),
			schedules.map((s) => ({ label: s.sro_desc, value: String(s.sro_id) }))
		);
		if (!chosen) return;

		let schedule = schedules.find((s) => String(s.sro_id) === chosen);
		let serials = await frappe.xcall("di.integrations.reference_api.get_sro_items_for_schedule", {
			sro_id: chosen
		});

		if (!serials || !serials.length) {
			frappe.msgprint(__("FBR returned no item serials for {0}.", [schedule.sro_desc]));
			continue;
		}

		let serial = await pick_option(
			__("Item Serial under {0}", [schedule.sro_desc]),
			serials.map((s) => ({ label: s.serial, value: s.serial }))
		);
		if (!serial) return;

		frappe.model.set_value(row.doctype, row.name, "sro_schedule_no", schedule.sro_desc);
		frappe.model.set_value(row.doctype, row.name, "sro_item_serial_no", serial);
	}
}

function pick_option(title, options) {
	return new Promise((resolve) => {
		let d = new frappe.ui.Dialog({
			title: title,
			fields: [
				{
					fieldname: "choice",
					fieldtype: "Select",
					label: __("Choose"),
					options: options.map((o) => o.label),
					reqd: 1
				}
			],
			primary_action_label: __("Use this"),
			primary_action(values) {
				let match = options.find((o) => o.label === values.choice);
				d.hide();
				resolve(match ? match.value : null);
			}
		});
		d.onhide = () => resolve(null);
		d.show();
	});
}

function add_fbr_buttons(frm) {
	if (frm.is_new()) return;

	if (frm.doc.docstatus === 0) {
		frm.add_custom_button(
			__("Fill SRO Details"),
			() => fill_sro_details(frm),
			__("Digital Invoicing")
		);
	}

	frm.add_custom_button(
		__("DI Preview"),
		() => {
			frappe
				.xcall("di.api.get_invoice_preview", {
					doctype: frm.doc.doctype,
					name: frm.doc.name
				})
				.then((payload) => {
					let d = new frappe.ui.Dialog({
						title: __("Digital Invoice Preview"),
						size: "extra-large"
					});
					d.$body.html(
						`<pre style="max-height:500px;overflow:auto;font-size:12px;">${JSON.stringify(
							payload,
							null,
							2
						)}</pre>`
					);
					d.show();
				});
		},
		__("Digital Invoicing")
	);

	frm.add_custom_button(
		__("Validate with FBR"),
		() => {
			frappe
				.xcall("di.api.validate_sale_tax_invoice", {
					name: frm.doc.name
				})
				.then((response) => {
					let vr = response.validationResponse || {};
					let status = vr.status || "Unknown";
					frappe.msgprint({
						title: __("FBR Validation Result"),
						indicator: status === "Valid" ? "green" : "red",
						message:
							status === "Valid"
								? __("Invoice is valid according to FBR")
								: describe_fbr_errors(vr)
					});
				});
		},
		__("Digital Invoicing")
	);

	if (frm.doc.docstatus === 1 && !frm.doc.fbr_invoice_no) {
		frm.add_custom_button(
			__("Post to FBR"),
			() => {
				frappe.confirm(__("Are you sure you want to post this invoice to FBR?"), () => {
					frappe
						.xcall("di.api.post_sale_tax_invoice", {
							name: frm.doc.name
						})
						.then(() => {
							frappe.msgprint(__("Sale Tax Invoice posted to FBR successfully"));
							frm.reload_doc();
						});
				});
			},
			__("Digital Invoicing")
		);
	}
}
