const DI_INVOICE_PICKER_KEY = "di.sale_tax_invoice.selection.v2";

frappe.listview_settings["Sale Tax Invoice"] = {
	add_fields: ["fbr_environment", "seller__business_name", "docstatus"],

	get_indicator(doc) {
		if (cstr(doc.fbr_environment) === "Production") {
			return [__("Production"), "red", "fbr_environment,=,Production"];
		}
		return [__("Sandbox"), "orange", "fbr_environment,=,Sandbox"];
	},

	onload(listview) {
		inject_invoice_picker_css();
		bind_invoice_picker(listview);
		patch_invoice_list_args(listview);
		render_invoice_picker(listview);
		hide_restriction_badge(listview);
	},

	refresh(listview) {
		render_invoice_picker(listview);
		hide_restriction_badge(listview);
	},
};

function cstr(value) {
	return value == null ? "" : String(value);
}

function escape_html(value) {
	if (window.frappe?.utils?.escape_html) {
		return frappe.utils.escape_html(cstr(value));
	}
	return cstr(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function read_selection() {
	try {
		return JSON.parse(sessionStorage.getItem(DI_INVOICE_PICKER_KEY) || "{}") || {};
	} catch (error) {
		return {};
	}
}

function write_selection(selection) {
	sessionStorage.setItem(DI_INVOICE_PICKER_KEY, JSON.stringify(selection || {}));
}

function clear_selection() {
	sessionStorage.removeItem(DI_INVOICE_PICKER_KEY);
}

function hide_restriction_badge(listview) {
	if (listview.restricted_list) {
		listview.restricted_list.hide();
	}
	if (listview.page && listview.page.wrapper) {
		listview.page.wrapper.find(".restricted-button").hide();
	}
}

function apply_suggested_selection(listview, suggested) {
	if (listview.__di_force_picker || !suggested || !suggested.company) {
		return false;
	}
	const current = read_selection();
	if (suggested.environment === "All") {
		if (current.company === suggested.company && current.environment === "All") {
			return false;
		}
		write_selection(suggested);
		return true;
	}
	if (current.environment || current.company === suggested.company) {
		return false;
	}
	write_selection(suggested);
	return Boolean(suggested.environment);
}

function filter_value(listview, fieldname) {
	const filters = (listview.filter_area && listview.filter_area.get()) || [];
	const row = filters.find((item) => item[1] === fieldname && item[2] === "=");
	return row ? row[3] : "";
}

function selection_from_filters(listview) {
	const company = filter_value(listview, "seller__business_name");
	const environment = filter_value(listview, "fbr_environment");
	if (company && environment) {
		return { company, environment };
	}
	return {};
}

function arriving_from_invoice_form() {
	const prev = frappe.get_prev_route ? frappe.get_prev_route() : [];
	return prev[0] === "Form" && prev[1] === "Sale Tax Invoice";
}

function bind_invoice_picker(listview) {
	if (listview.__di_invoice_picker_bound) {
		return;
	}
	listview.__di_invoice_picker_bound = true;

	const company = filter_value(listview, "seller__business_name");
	const existing = read_selection();
	if (company && !existing.company) {
		write_selection({ company });
		return;
	}
	if (!arriving_from_invoice_form() && !existing.company) {
		write_selection({});
	}
}

function picker_host(listview) {
	let $host = listview.page.main.children(".di-invoice-picker");
	if (!$host.length) {
		$host = $('<div class="di-invoice-picker" hidden></div>');
		listview.page.main.prepend($host);
	}
	return $host;
}

function set_picker_mode(listview, active) {
	listview.page.wrapper.toggleClass("di-invoice-picker-open", active);
	if (listview.$frappe_list) {
		listview.$frappe_list.toggle(!active);
	}
	if (active) {
		listview.page.btn_primary && listview.page.btn_primary.hide();
	} else {
		listview.page.btn_primary && listview.page.btn_primary.show();
	}
}

function render_invoice_picker(listview) {
	if (!listview || !listview.page) {
		return;
	}

	const selection = read_selection();
	if (selection.company && selection.environment) {
		set_picker_mode(listview, false);
		picker_host(listview).attr("hidden", true).empty();
		ensure_invoice_filters(listview, selection);
		render_invoice_toolbar(listview, selection);
		return;
	}

	set_picker_mode(listview, true);
	toggle_invoice_toolbar(listview, false);
	if (listview.page.clear_indicator) {
		listview.page.clear_indicator();
	}
	load_invoice_picker(listview, selection);
}

function patch_invoice_list_args(listview) {
	if (listview.__di_args_patched || !listview.get_args) {
		return;
	}
	listview.__di_args_patched = true;
	const original = listview.get_args.bind(listview);
	listview.get_args = function () {
		const args = original();
		const selection = read_selection();
		if (!selection.company || !selection.environment) {
			return args;
		}
		args.filters = (args.filters || []).filter(
			(row) => row[1] !== "seller__business_name" && row[1] !== "fbr_environment"
		);
		args.filters.push(["Sale Tax Invoice", "seller__business_name", "=", selection.company]);
		if (selection.environment !== "All") {
			args.filters.push(["Sale Tax Invoice", "fbr_environment", "=", selection.environment]);
		}
		return args;
	};
}

function ensure_invoice_filters(listview, selection) {
	if (!listview.filter_area || listview.__di_applying_filters) {
		return;
	}
	const company = filter_value(listview, "seller__business_name");
	const environment = filter_value(listview, "fbr_environment");
	const env_ok =
		selection.environment === "All" ? !environment : environment === selection.environment;
	if (company === selection.company && env_ok) {
		return;
	}

	const filters = [["Sale Tax Invoice", "seller__business_name", "=", selection.company]];
	if (selection.environment !== "All") {
		filters.push(["Sale Tax Invoice", "fbr_environment", "=", selection.environment]);
	}

	listview.__di_applying_filters = true;
	Promise.resolve(listview.filter_area.clear(false))
		.then(() => listview.filter_area.add(filters))
		.catch(() => {
			listview.refresh();
		})
		.finally(() => {
			listview.__di_applying_filters = false;
		});
}

function toggle_invoice_toolbar(listview, visible) {
	if (listview.__di_change_company_button) {
		listview.__di_change_company_button.toggle(visible);
	}
}

function render_invoice_toolbar(listview, selection) {
	const label =
		selection.environment === "All"
			? selection.company
			: `${selection.company} · ${selection.environment}`;
	const color =
		selection.environment === "Production" ? "red" : selection.environment === "All" ? "blue" : "orange";
	listview.page.set_indicator(label, color);

	if (!listview.__di_change_company_button) {
		listview.__di_change_company_button = listview.page.add_inner_button(__("Change Company"), () => {
			clear_selection();
			listview.__di_force_picker = true;
			listview.__di_picker_cache = null;
			if (listview.filter_area) {
				listview.filter_area.clear(false);
			}
			render_invoice_picker(listview);
		});
	}
	const companies = listview.__di_picker_cache || [];
	toggle_invoice_toolbar(listview, selection.environment !== "All" && companies.length !== 1);
}

function load_invoice_picker(listview, selection) {
	const $host = picker_host(listview);
	if ($host.data("loading")) {
		return;
	}
	if (listview.__di_picker_cache) {
		paint_invoice_picker(listview, listview.__di_picker_cache, selection);
		return;
	}

	$host.data("loading", true);
	$host.removeAttr("hidden").html(`<p class="text-muted">${__("Loading companies...")}</p>`);

	frappe.call({
		method: "di.api.get_sale_invoice_company_cards",
		callback(response) {
			$host.data("loading", false);
			const message = response.message || {};
			const companies = message.companies || [];
			listview.__di_picker_cache = companies;
			if (apply_suggested_selection(listview, message.default_selection || {})) {
				render_invoice_picker(listview);
				return;
			}
			paint_invoice_picker(listview, companies, read_selection());
		},
		error() {
			$host.data("loading", false);
			$host.html(`<p class="text-danger">${__("Could not load companies.")}</p>`);
		},
	});
}

function paint_invoice_picker(listview, companies, selection) {
	const $host = picker_host(listview).removeAttr("hidden");

	if (selection.company) {
		const company = companies.find((row) => row.name === selection.company) || {
			name: selection.company,
			sandbox: 0,
			production: 0,
		};
		$host.html(environment_picker_html(company));
		$host.find("[data-back-companies]").on("click", () => {
			write_selection({});
			paint_invoice_picker(listview, companies, {});
		});
		$host.find("[data-environment]").on("click", function () {
			write_selection({
				company: selection.company,
				environment: $(this).data("environment"),
			});
			render_invoice_picker(listview);
		});
		return;
	}

	$host.html(company_picker_html(companies));
	const $search = $host.find("[data-company-search]");
	const $cards = $host.find("[data-company-card]");
	$search.on("input", function () {
		const query = cstr(this.value).toLowerCase();
		$cards.each(function () {
			const haystack = cstr($(this).data("search"));
			$(this).toggle(haystack.indexOf(query) !== -1);
		});
	});
	$cards.on("click", function () {
		write_selection({ company: $(this).data("company") });
		paint_invoice_picker(listview, companies, read_selection());
	});
}

function company_picker_html(companies) {
	const cards = (companies || [])
		.map((company) => {
			const search = [company.name, company.ntn, company.province].join(" ").toLowerCase();
			const meta = [company.ntn && `NTN ${company.ntn}`, company.province].filter(Boolean).join(" · ");
			return `<button type="button" class="di-invoice-card" data-company-card data-company="${escape_html(
				company.name
			)}" data-search="${escape_html(search)}">
				<strong>${escape_html(company.name)}</strong>
				<span class="text-muted">${escape_html(meta || __("No NTN on file"))}</span>
				<span class="di-invoice-card__counts">
					${__("Sandbox")}: ${cint(company.sandbox)} · ${__("Production")}: ${cint(company.production)}
				</span>
			</button>`;
		})
		.join("");

	return `<div class="di-invoice-picker__inner">
		<h3>${__("Select a company")}</h3>
		<p class="text-muted">${__("Choose a Seller / Company, then open Sandbox or Production invoices.")}</p>
		${
			companies.length
				? `<input type="search" class="form-control di-invoice-search" data-company-search placeholder="${__(
						"Search companies"
					)}" aria-label="${__("Search companies")}">
					<div class="di-invoice-grid">${cards}</div>`
				: `<div class="empty-state">
					<p>${__("No Seller / Company found.")}</p>
					<a class="btn btn-default btn-sm" href="/desk/seller-or-company">${__("Go to Seller / Company")}</a>
				</div>`
		}
	</div>`;
}

function environment_picker_html(company) {
	return `<div class="di-invoice-picker__inner">
		<button type="button" class="btn btn-default btn-sm di-invoice-back" data-back-companies>
			${__("Back to companies")}
		</button>
		<h3>${escape_html(company.name)}</h3>
		<p class="text-muted">${__("Which invoices do you want to open?")}</p>
		<div class="di-invoice-env-grid">
			<button type="button" class="di-invoice-env" data-environment="Sandbox">
				<strong>${__("Sandbox Invoices")}</strong>
				<span>${cint(company.sandbox)} ${__("invoices")}</span>
			</button>
			<button type="button" class="di-invoice-env di-invoice-env--production" data-environment="Production">
				<strong>${__("Production Invoices")}</strong>
				<span>${cint(company.production)} ${__("invoices")}</span>
			</button>
		</div>
	</div>`;
}

function inject_invoice_picker_css() {
	if (document.getElementById("di-invoice-picker-style")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "di-invoice-picker-style";
	style.textContent = `
		.di-invoice-picker-open .page-form,
		.di-invoice-picker-open .filter-section,
		.di-invoice-picker-open .standard-filter-section {
			display: none !important;
		}
		.page-sale-tax-invoice .restricted-button {
			display: none !important;
		}
		.di-invoice-picker {
			padding: 8px 4px 28px;
		}
		.di-invoice-picker__inner h3 {
			margin: 8px 0 4px;
			font-size: 1.15rem;
		}
		.di-invoice-search {
			max-width: 360px;
			margin: 12px 0 16px;
		}
		.di-invoice-grid,
		.di-invoice-env-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
			gap: 12px;
		}
		.di-invoice-card,
		.di-invoice-env {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 6px;
			width: 100%;
			text-align: left;
			border: 1px solid var(--border-color);
			border-radius: var(--border-radius-md, 8px);
			background: var(--card-bg, var(--fg-color));
			padding: 16px;
			cursor: pointer;
		}
		.di-invoice-card:hover,
		.di-invoice-card:focus-visible,
		.di-invoice-env:hover,
		.di-invoice-env:focus-visible {
			border-color: var(--primary);
			box-shadow: var(--shadow-sm);
			outline: none;
		}
		.di-invoice-card__counts,
		.di-invoice-env span {
			color: var(--text-muted);
			font-size: var(--text-sm, 12px);
		}
		.di-invoice-env {
			min-height: 110px;
			justify-content: center;
		}
		.di-invoice-env--production {
			border-color: var(--red-300, #fca5a5);
		}
		.di-invoice-back {
			margin-bottom: 8px;
		}
		@media (max-width: 767px) {
			.di-invoice-grid,
			.di-invoice-env-grid {
				grid-template-columns: 1fr;
			}
		}
	`;
	document.head.appendChild(style);
}
