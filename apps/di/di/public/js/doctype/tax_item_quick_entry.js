// Copyright (c) 2026, kodlyft and Contributors
// For license information, please see license.txt

frappe.provide("frappe.ui.form");
frappe.provide("di.tax_item");

di.tax_item.product_uom_fallback_values = di.tax_item.product_uom_fallback_values || [
	"MT",
	"Bill of lading",
	"SET",
	"KWH",
	"40KG",
	"Liter",
	"SqY",
	"Bag",
	"KG",
	"MMBTU",
	"Meter",
	"Carat",
	"Cubic Metre",
	"Dozen",
	"Gram",
	"Gallon",
	"Kilogram",
	"Pound",
	"Timber Logs",
	"Numbers, pieces, units",
	"Packs",
	"Pair",
	"Square Foot",
	"Square Metre",
	"Thousand Unit",
	"Mega Watt",
	"Foot",
	"Barrels",
	"NO",
	"Others",
	"1000 kWh"
];

register_tax_item_quick_entry();

function register_tax_item_quick_entry() {
	if (!frappe.ui.form.QuickEntryForm) {
		setTimeout(register_tax_item_quick_entry, 100);
		return;
	}

	frappe.ui.form.TaxItemQuickEntryForm = class TaxItemQuickEntryForm extends frappe.ui.form.QuickEntryForm {
		render_dialog() {
			super.render_dialog();
			bind_hs_code_quick_entry(this);
			bind_quick_entry_product_uom_suggestions(this);
		}
	};
}

function set_hs_code_query(frm) {
	frm.set_query("hs_code", () => ({ filters: {} }));
}

function add_fetch_tax_rate_button(frm) {
	frm.add_custom_button(__("Fetch Tax Rate"), () => fetch_tax_rate_for_form(frm, true));
}

function set_product_details_from_hs_code(frm, open_description_options = false, update_product_uom = true) {
	if (!frm.doc.hs_code) {
		bind_form_product_description_suggestions(frm, [], false);
		return;
	}

	let selected_hs_code = frm.doc.hs_code;
	get_hs_code_details(selected_hs_code).then((details) => {
		if (frm.doc.hs_code !== selected_hs_code) {
			return;
		}

		if (update_product_uom) {
			frm.set_value("product_uom", details.product_uom || "").then(() => fetch_tax_rate_for_form(frm));
		} else {
			fetch_tax_rate_for_form(frm);
		}
		bind_form_product_description_suggestions(
			frm,
			details.description_options || [],
			open_description_options
		);
	});
}

function bind_hs_code_quick_entry(quick_entry) {
	let hs_code_field = quick_entry.dialog.fields_dict.hs_code;
	if (!hs_code_field) {
		return;
	}

	hs_code_field.df.onchange = () => set_quick_entry_product_details(quick_entry);
	hs_code_field.refresh();
}

function set_quick_entry_product_details(quick_entry) {
	let dialog = quick_entry.dialog;
	let hs_code = dialog.get_value("hs_code");
	if (!hs_code) {
		return;
	}

	get_hs_code_details(hs_code).then((details) => {
		if (dialog.get_value("hs_code") !== hs_code) {
			return;
		}

		let set_uom = dialog.set_value("product_uom", details.product_uom || "");
		bind_quick_entry_product_description_suggestions(
			quick_entry,
			details.description_options || [],
			true
		);
		Promise.resolve(set_uom).then(() => fetch_tax_rate_for_quick_entry(quick_entry));
	});
}

function get_hs_code_details(hs_code) {
	return frappe.xcall("di.digital_invoicing.doctype.tax_item.tax_item.get_hs_code_details", {
		hs_code
	});
}

function fetch_tax_rate_for_form(frm, show_errors = false) {
	if (!frm.doc.hs_code || !frm.doc.product_uom) {
		if (show_errors) {
			frappe.msgprint(__("Select HS Code and Product UOM before fetching tax rate."));
		}
		return;
	}

	let request_key = [
		frm.doc.hs_code,
		frm.doc.product_uom,
		frm.doc.transaction_type || "",
		frappe.defaults.get_default("company") || ""
	].join("|");
	frm.di_tax_rate_request_key = request_key;

	get_tax_rate_details({
		hs_code: frm.doc.hs_code,
		product_uom: frm.doc.product_uom,
		transaction_type: frm.doc.transaction_type,
		company: frappe.defaults.get_default("company")
	})
		.then((details) => {
			if (frm.di_tax_rate_request_key !== request_key) return;
			choose_tax_rate_if_needed(details, (selected) => apply_tax_rate_to_form(frm, selected));
		})
		.catch((err) => {
			if (show_errors) {
				frappe.msgprint({
					title: __("Tax Rate Lookup Failed"),
					message: err.message || err,
					indicator: "red"
				});
			}
		});
}

function fetch_tax_rate_for_quick_entry(quick_entry) {
	let dialog = quick_entry.dialog;
	let hs_code = dialog.get_value("hs_code");
	let product_uom = dialog.get_value("product_uom");
	if (!hs_code || !product_uom) return;

	let request_key = [hs_code, product_uom, dialog.get_value("transaction_type") || ""].join("|");
	dialog.di_tax_rate_request_key = request_key;

	get_tax_rate_details({
		hs_code,
		product_uom,
		transaction_type: dialog.get_value("transaction_type"),
		company: frappe.defaults.get_default("company")
	})
		.then((details) => {
			if (dialog.di_tax_rate_request_key !== request_key) return;
			choose_tax_rate_if_needed(details, (selected) =>
				apply_tax_rate_to_quick_entry(dialog, selected)
			);
		})
		.catch((err) => {
			frappe.show_alert(
				{
					message: __("Tax rate was not fetched: {0}", [err.message || err]),
					indicator: "orange"
				},
				8
			);
		});
}

function get_tax_rate_details(args) {
	return frappe.xcall("di.digital_invoicing.doctype.tax_item.tax_item.get_tax_rate_details", args);
}

function choose_tax_rate_if_needed(details, apply_rate) {
	let options = details.rate_options || [];
	if (!details.ambiguous || options.length <= 1) {
		apply_rate(details);
		return;
	}

	let labels = options.map((option) => get_rate_option_label(option));
	frappe.prompt(
		[
			{
				fieldname: "rate_label",
				fieldtype: "Select",
				label: __("Tax Rate"),
				options: labels.join("\n"),
				reqd: 1,
				default: labels[0]
			}
		],
		(values) => {
			let selected_index = labels.indexOf(values.rate_label);
			let selected = Object.assign({}, details, options[selected_index >= 0 ? selected_index : 0], {
				ambiguous: false
			});
			apply_rate(selected);
		},
		__("Select Tax Rate")
	);
}

function get_rate_option_label(option) {
	let desc = option.tax_desc || __("Unknown Rate");
	let value = option.rate_in_p !== undefined && option.rate_in_p !== null ? ` (${option.rate_in_p}%)` : "";
	return `${desc}${value}`;
}

function apply_tax_rate_to_form(frm, details) {
	frm.set_value("tax_desc", details.tax_desc || "");
	frm.set_value("rate_in_p", flt(details.rate_in_p));
	frm.set_value("rate_id", details.rate_id || "");
	if (!frm.doc.transaction_type && details.transaction_type) {
		frm.set_value("transaction_type", details.transaction_type);
	}
	frappe.show_alert({
		message: __("Tax rate fetched from FBR"),
		indicator: "green"
	});
}

function apply_tax_rate_to_quick_entry(dialog, details) {
	dialog.set_value("tax_desc", details.tax_desc || "");
	if (dialog.fields_dict.rate_in_p) {
		dialog.set_value("rate_in_p", flt(details.rate_in_p));
	}
	if (dialog.fields_dict.rate_id) {
		dialog.set_value("rate_id", details.rate_id || "");
	}
	if (dialog.fields_dict.transaction_type && !dialog.get_value("transaction_type")) {
		dialog.set_value("transaction_type", details.transaction_type || "");
	}
}

function bind_form_product_description_suggestions(frm, options, open_menu = false) {
	bind_product_description_suggestions(
		frm.fields_dict.product_description,
		options,
		(value) => frm.set_value("product_description", value),
		open_menu
	);
}

function bind_quick_entry_product_description_suggestions(quick_entry, options, open_menu = false) {
	bind_product_description_suggestions(
		quick_entry.dialog.fields_dict.product_description,
		options,
		(value) => quick_entry.dialog.set_value("product_description", value),
		open_menu
	);
}

function bind_product_description_suggestions(field, options, set_value, open_menu = false) {
	if (!field || !field.$input || !field.$input.length) {
		return;
	}

	setup_product_description_menu(field, get_product_description_suggestion_list(options), set_value);

	if (open_menu) {
		setTimeout(() => render_product_description_menu(field, set_value, true), 80);
	}
}

function get_product_description_suggestion_list(options) {
	return (options || [])
		.map((option) => ({
			number: option.number,
			label: option.label || `${option.number}. ${option.value}`,
			value: option.value || "",
			search_text: option.search_text || `${option.number || ""} ${option.value || ""}`.trim()
		}))
		.filter((option) => option.value);
}

function setup_product_description_menu(field, options, set_value) {
	let input = field.$input.get(0);
	if (!input) {
		return;
	}

	input.setAttribute("autocomplete", "off");
	input.di_product_description_options = options;

	if (input.di_product_description_menu) {
		render_product_description_menu(field, set_value);
		return;
	}

	input.di_product_description_active_index = -1;
	input.di_product_description_menu = create_product_description_menu();

	input.addEventListener("focus", () => render_product_description_menu(field, set_value, true));
	input.addEventListener("click", () => render_product_description_menu(field, set_value, true));
	input.addEventListener("input", () => {
		input.di_product_description_active_index = -1;
		render_product_description_menu(field, set_value);
	});
	input.addEventListener("keydown", (event) => handle_product_description_keydown(event, field, set_value));
	input.addEventListener("blur", () => {
		setTimeout(() => hide_product_description_menu(input), 150);
	});

	document.addEventListener("mousedown", (event) => {
		if (event.target === input || input.di_product_description_menu.contains(event.target)) {
			return;
		}
		hide_product_description_menu(input);
	});
}

function create_product_description_menu() {
	inject_product_description_menu_css();

	let menu = document.createElement("div");
	menu.className = "di-product-description-menu hidden";
	menu.setAttribute("role", "listbox");
	document.body.appendChild(menu);
	return menu;
}

function inject_product_description_menu_css() {
	if (document.getElementById("di-product-description-menu-style")) {
		return;
	}

	let style = document.createElement("style");
	style.id = "di-product-description-menu-style";
	style.textContent = `
		.di-product-description-menu {
			position: absolute;
			z-index: 2000;
			max-height: 260px;
			overflow-y: auto;
			background: #fff;
			border: 1px solid var(--border-color, #d1d8dd);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
			padding: 4px;
			font-size: 13px;
		}
		.di-product-description-menu.hidden {
			display: none;
		}
		.di-product-description-option {
			border-radius: 6px;
			cursor: pointer;
			line-height: 1.35;
			padding: 8px 10px;
			white-space: normal;
			word-break: break-word;
		}
		.di-product-description-option:hover,
		.di-product-description-option.active {
			background: var(--control-bg, #f4f5f6);
		}
	`;
	document.head.appendChild(style);
}

function render_product_description_menu(field, set_value, show_all = false) {
	let input = field.$input.get(0);
	let menu = input.di_product_description_menu;
	let options = show_all
		? input.di_product_description_options || []
		: get_product_description_visible_options(input.value, input.di_product_description_options || []);

	if (!menu || !options.length) {
		hide_product_description_menu(input);
		return;
	}

	input.di_product_description_visible_options = options;
	if (input.di_product_description_active_index >= options.length) {
		input.di_product_description_active_index = -1;
	}

	menu.innerHTML = "";
	options.forEach((option, index) => {
		let item = document.createElement("div");
		item.className = "di-product-description-option";
		item.dataset.index = index;
		item.setAttribute("role", "option");
		item.textContent = option.label;
		if (index === input.di_product_description_active_index) {
			item.classList.add("active");
		}
		item.addEventListener("mousedown", (event) => {
			event.preventDefault();
			set_product_description_value(field, option.value, set_value);
			hide_product_description_menu(input);
		});
		menu.appendChild(item);
	});

	position_product_description_menu(input, menu);
	menu.classList.remove("hidden");
}

function get_product_description_visible_options(input_value, options) {
	let query = get_product_description_query(input_value);
	if (!query) {
		return options || [];
	}

	let number_query = query.replace(/\.$/, "");
	return (options || [])
		.map((option, index) => ({
			option,
			index,
			rank: get_product_description_match_rank(option, query, number_query)
		}))
		.filter((entry) => entry.rank > -1)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.option);
}

function get_product_description_query(input_value) {
	return (String(input_value || "").split(" - ").pop() || "").trim().toLowerCase();
}

function get_product_description_match_rank(option, query, number_query) {
	let number = String(option.number || "");
	let label = (option.label || "").toLowerCase();
	let value = (option.value || "").toLowerCase();
	let search_text = (option.search_text || "").toLowerCase();

	if (number === number_query || label === query || value === query) {
		return 0;
	}

	if (number.startsWith(number_query) || label.startsWith(query) || value.startsWith(query)) {
		return 1;
	}

	if (search_text.includes(query) || label.includes(query) || value.includes(query)) {
		return 2;
	}

	return -1;
}

function handle_product_description_keydown(event, field, set_value) {
	let input = field.$input.get(0);
	let visible_options = input.di_product_description_visible_options || [];

	if (!visible_options.length && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
		render_product_description_menu(field, set_value);
		visible_options = input.di_product_description_visible_options || [];
	}

	if (event.key === "ArrowDown") {
		event.preventDefault();
		input.di_product_description_active_index = Math.min(
			(input.di_product_description_active_index || -1) + 1,
			visible_options.length - 1
		);
		render_product_description_menu(field, set_value);
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		input.di_product_description_active_index = Math.max(
			(input.di_product_description_active_index || 0) - 1,
			0
		);
		render_product_description_menu(field, set_value);
	} else if (event.key === "Enter" && input.di_product_description_active_index >= 0) {
		event.preventDefault();
		let option = visible_options[input.di_product_description_active_index];
		if (option) {
			set_product_description_value(field, option.value, set_value);
			hide_product_description_menu(input);
		}
	} else if (event.key === "Escape") {
		hide_product_description_menu(input);
	}
}

function set_product_description_value(field, value, set_value) {
	let input = field.$input.get(0);
	let next_value = build_product_description_value(input.value, value);

	if (next_value.length > 140) {
		frappe.show_alert({
			message: __("Product Description can be maximum 140 characters. Select fewer options or shorten it manually."),
			indicator: "orange"
		});
		return;
	}

	if (set_value) {
		set_value(next_value);
	} else if (field.set_value) {
		field.set_value(next_value);
	} else if (field.set_input) {
		field.set_input(next_value);
	}

	field.$input.val(next_value).trigger("change");
}

function build_product_description_value(current_value, selected_value) {
	let separator = " - ";
	let current = (current_value || "").trim();
	let selected = (selected_value || "").trim();

	if (!current) {
		return selected;
	}

	let parts = current
		.split(separator)
		.map((part) => part.trim())
		.filter(Boolean);
	let selected_lower = selected.toLowerCase();

	if (parts.some((part) => part.toLowerCase() === selected_lower)) {
		return parts.join(separator);
	}

	let last = parts[parts.length - 1] || "";
	let last_lower = last.toLowerCase();
	if (last_lower && selected_lower.includes(last_lower) && selected_lower !== last_lower) {
		parts[parts.length - 1] = selected;
		return parts.join(separator);
	}

	parts.push(selected);
	return parts.join(separator);
}

function position_product_description_menu(input, menu) {
	let rect = input.getBoundingClientRect();
	menu.style.left = `${rect.left + window.scrollX}px`;
	menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
	menu.style.width = `${Math.max(rect.width, 360)}px`;
}

function hide_product_description_menu(input) {
	if (input && input.di_product_description_menu) {
		input.di_product_description_menu.classList.add("hidden");
	}
}

function bind_form_product_uom_suggestions(frm) {
	bind_product_uom_suggestions(frm.fields_dict.product_uom, (value) => frm.set_value("product_uom", value));
}

function bind_quick_entry_product_uom_suggestions(quick_entry) {
	let product_uom_field = quick_entry.dialog.fields_dict.product_uom;
	if (product_uom_field) {
		product_uom_field.df.onchange = () => fetch_tax_rate_for_quick_entry(quick_entry);
		product_uom_field.refresh();
	}

	let transaction_type_field = quick_entry.dialog.fields_dict.transaction_type;
	if (transaction_type_field) {
		transaction_type_field.df.onchange = () => fetch_tax_rate_for_quick_entry(quick_entry);
		transaction_type_field.refresh();
	}

	bind_product_uom_suggestions(product_uom_field, (value) => {
		Promise.resolve(quick_entry.dialog.set_value("product_uom", value)).then(() =>
			fetch_tax_rate_for_quick_entry(quick_entry)
		);
	});
}

function bind_product_uom_suggestions(field, set_value) {
	if (!field || !field.$input || !field.$input.length) {
		return;
	}

	get_product_uom_options().then((options) => {
		setup_product_uom_autocomplete(field, get_product_uom_suggestion_list(options), set_value);
	});
}

function get_product_uom_options() {
	if (!di.tax_item.product_uom_options_promise) {
		di.tax_item.product_uom_options_promise = frappe
			.xcall("di.digital_invoicing.doctype.tax_item.tax_item.get_product_uom_options")
			.then((options) => (options && options.length ? options : get_product_uom_fallback_options()))
			.catch(() => get_product_uom_fallback_options());
	}

	return di.tax_item.product_uom_options_promise;
}

function get_product_uom_fallback_options() {
	return di.tax_item.product_uom_fallback_values.map((value, index) => ({
		number: index + 1,
		value,
		label: `${index + 1}. ${value}`,
		search_text: `${index + 1} ${value}`
	}));
}

function get_product_uom_suggestion_list(options) {
	return (options || [])
		.map((option) => ({
			number: option.number,
			label: option.label || `${option.number}. ${option.value}`,
			value: option.value || "",
			search_text: option.search_text || `${option.number || ""} ${option.value || ""}`.trim()
		}))
		.filter((option) => option.value);
}

function setup_product_uom_autocomplete(field, options, set_value) {
	let input = field.$input.get(0);
	if (!input) {
		return;
	}

	input.setAttribute("autocomplete", "off");

	if (input.di_product_uom_menu) {
		input.di_product_uom_options = options;
		render_product_uom_menu(field, set_value);
		return;
	}

	input.di_product_uom_options = options;
	input.di_product_uom_active_index = -1;
	input.di_product_uom_menu = create_product_uom_menu();

	input.addEventListener("focus", () => show_product_uom_suggestions(field, set_value));
	input.addEventListener("click", () => show_product_uom_suggestions(field, set_value));
	input.addEventListener("input", () => {
		input.di_product_uom_active_index = -1;
		render_product_uom_menu(field, set_value);
	});
	input.addEventListener("keydown", (event) => handle_product_uom_keydown(event, field, set_value));
	input.addEventListener("change", () => normalize_product_uom_input(field, options, set_value));
	input.addEventListener("blur", () => {
		setTimeout(() => {
			normalize_product_uom_input(field, input.di_product_uom_options || [], set_value);
			hide_product_uom_menu(input);
		}, 150);
	});

	document.addEventListener("mousedown", (event) => {
		if (event.target === input || input.di_product_uom_menu.contains(event.target)) {
			return;
		}
		hide_product_uom_menu(input);
	});
}

function normalize_product_uom_input(field, options, set_value) {
	let input = field.$input.get(0);
	let match = get_product_uom_match(input.value, options);

	if (match && input.value !== match.value) {
		set_product_uom_value(field, match.value, set_value);
	}
}

function get_product_uom_match(input_value, options) {
	let query = (input_value || "").trim().toLowerCase();
	if (!query) {
		return null;
	}

	let number_query = query.replace(/\.$/, "");
	return (options || []).find((option) => {
		return (
			String(option.number || "") === number_query ||
			(option.label || "").toLowerCase() === query ||
			(option.value || "").toLowerCase() === query
		);
	});
}

function get_product_uom_visible_options(input_value, options) {
	let query = (input_value || "").trim().toLowerCase();
	if (!query) {
		return options || [];
	}

	let number_query = query.replace(/\.$/, "");
	return (options || [])
		.map((option, index) => ({
			option,
			index,
			rank: get_product_uom_match_rank(option, query, number_query)
		}))
		.filter((entry) => entry.rank > -1)
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.option);
}

function get_product_uom_match_rank(option, query, number_query) {
	let number = String(option.number || "");
	let label = (option.label || "").toLowerCase();
	let value = (option.value || "").toLowerCase();
	let search_text = (option.search_text || "").toLowerCase();

	if (number === number_query || label === query || value === query) {
		return 0;
	}

	if (number.startsWith(number_query) || label.startsWith(query) || value.startsWith(query)) {
		return 1;
	}

	if (search_text.includes(query) || label.includes(query) || value.includes(query)) {
		return 2;
	}

	return -1;
}

function create_product_uom_menu() {
	inject_product_uom_menu_css();

	let menu = document.createElement("div");
	menu.className = "di-product-uom-menu hidden";
	menu.setAttribute("role", "listbox");
	document.body.appendChild(menu);
	return menu;
}

function inject_product_uom_menu_css() {
	if (document.getElementById("di-product-uom-menu-style")) {
		return;
	}

	let style = document.createElement("style");
	style.id = "di-product-uom-menu-style";
	style.textContent = `
		.di-product-uom-menu {
			position: absolute;
			z-index: 2000;
			max-height: 240px;
			overflow-y: auto;
			background: #fff;
			border: 1px solid var(--border-color, #d1d8dd);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
			padding: 4px;
			font-size: 13px;
		}
		.di-product-uom-menu.hidden {
			display: none;
		}
		.di-product-uom-option {
			border-radius: 6px;
			cursor: pointer;
			line-height: 1.4;
			padding: 8px 10px;
			white-space: nowrap;
		}
		.di-product-uom-option:hover,
		.di-product-uom-option.active {
			background: var(--control-bg, #f4f5f6);
		}
	`;
	document.head.appendChild(style);
}

function show_product_uom_suggestions(field, set_value) {
	render_product_uom_menu(field, set_value, true);
}

function render_product_uom_menu(field, set_value, show_all = false) {
	let input = field.$input.get(0);
	let menu = input.di_product_uom_menu;
	let options = show_all
		? input.di_product_uom_options || []
		: get_product_uom_visible_options(input.value, input.di_product_uom_options || []);

	if (!menu || !options.length) {
		hide_product_uom_menu(input);
		return;
	}

	input.di_product_uom_visible_options = options;
	if (input.di_product_uom_active_index >= options.length) {
		input.di_product_uom_active_index = -1;
	}

	menu.innerHTML = "";
	options.forEach((option, index) => {
		let item = document.createElement("div");
		item.className = "di-product-uom-option";
		item.dataset.index = index;
		item.setAttribute("role", "option");
		item.textContent = option.label;
		if (index === input.di_product_uom_active_index) {
			item.classList.add("active");
		}
		item.addEventListener("mousedown", (event) => {
			event.preventDefault();
			set_product_uom_value(field, option.value, set_value);
			hide_product_uom_menu(input);
		});
		menu.appendChild(item);
	});

	position_product_uom_menu(input, menu);
	menu.classList.remove("hidden");
}

function position_product_uom_menu(input, menu) {
	let rect = input.getBoundingClientRect();
	menu.style.left = `${rect.left + window.scrollX}px`;
	menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
	menu.style.width = `${rect.width}px`;
}

function hide_product_uom_menu(input) {
	if (input && input.di_product_uom_menu) {
		input.di_product_uom_menu.classList.add("hidden");
	}
}

function handle_product_uom_keydown(event, field, set_value) {
	let input = field.$input.get(0);
	let visible_options = input.di_product_uom_visible_options || [];

	if (!visible_options.length && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
		show_product_uom_suggestions(field, set_value);
		visible_options = input.di_product_uom_visible_options || [];
	}

	if (event.key === "ArrowDown") {
		event.preventDefault();
		input.di_product_uom_active_index = Math.min(
			(input.di_product_uom_active_index || -1) + 1,
			visible_options.length - 1
		);
		render_product_uom_menu(field, set_value);
	} else if (event.key === "ArrowUp") {
		event.preventDefault();
		input.di_product_uom_active_index = Math.max((input.di_product_uom_active_index || 0) - 1, 0);
		render_product_uom_menu(field, set_value);
	} else if (event.key === "Enter" && input.di_product_uom_active_index >= 0) {
		event.preventDefault();
		let option = visible_options[input.di_product_uom_active_index];
		if (option) {
			set_product_uom_value(field, option.value, set_value);
			hide_product_uom_menu(input);
		}
	} else if (event.key === "Escape") {
		hide_product_uom_menu(input);
	}
}

function set_product_uom_value(field, value, set_value) {
	if (set_value) {
		set_value(value);
	} else if (field.set_value) {
		field.set_value(value);
	} else if (field.set_input) {
		field.set_input(value);
	}

	field.$input.val(value).trigger("change");
}

di.tax_item.get_product_uom_suggestion_list = get_product_uom_suggestion_list;
di.tax_item.get_product_uom_match = get_product_uom_match;
di.tax_item.get_product_uom_visible_options = get_product_uom_visible_options;
