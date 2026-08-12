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

function add_fbr_buttons(frm) {
	if (frm.is_new()) return;

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
								: __("Validation result: {0}", [vr.error || status])
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
