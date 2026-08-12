frappe.listview_settings["HS Code"] = {
	hide_name_column: false,

	onload() {
		apply_hs_code_list_layout();
	},

	refresh() {
		apply_hs_code_list_layout();
	}
};

function apply_hs_code_list_layout() {
	sync_hs_code_list_route_class();
	inject_hs_code_list_css();
}

function sync_hs_code_list_route_class() {
	let route = frappe.get_route ? frappe.get_route() : [];
	let is_hs_code_list = route[0] === "List" && route[1] === "HS Code";

	document.body.classList.toggle("di-hs-code-list", is_hs_code_list);

	if (window.di_hs_code_list_route_listener) return;

	window.di_hs_code_list_route_listener = true;
	frappe.router.on("change", sync_hs_code_list_route_class);
}

function inject_hs_code_list_css() {
	if (document.getElementById("di-hs-code-list-style")) return;

	let style = document.createElement("style");
	style.id = "di-hs-code-list-style";
	style.textContent = `
		.di-hs-code-list .list-row-container .level-left,
		.di-hs-code-list .list-row-head .level-left {
			display: grid !important;
			grid-template-columns: minmax(240px, 280px) 60px 108px 80px 120px !important;
			column-gap: 10px !important;
			align-items: center !important;
			flex: 0 0 auto !important;
			width: auto !important;
			max-width: 688px !important;
		}

		.di-hs-code-list .list-row-container .list-subject,
		.di-hs-code-list .list-row-head .list-subject {
			flex: none !important;
			width: auto !important;
			min-width: 0 !important;
			max-width: 280px !important;
		}

		.di-hs-code-list .list-row-container .list-subject a,
		.di-hs-code-list .list-row-head .list-subject {
			display: block !important;
			overflow: hidden !important;
			text-overflow: ellipsis !important;
			white-space: nowrap !important;
		}

		.di-hs-code-list .list-row-col,
		.di-hs-code-list .list-row-head .list-row-col {
			flex: none !important;
			width: auto !important;
			min-width: 0 !important;
			padding-left: 0 !important;
			padding-right: 0 !important;
		}

		.di-hs-code-list .list-row-col[data-fieldname="sr_no"],
		.di-hs-code-list .list-row-col[data-fieldname="sr_no"] .ellipsis {
			text-align: right !important;
		}

		.di-hs-code-list .list-row-col[data-fieldname="name"],
		.di-hs-code-list .list-row-col[data-fieldname="name"] .ellipsis {
			text-align: left !important;
		}
	`;
	document.head.appendChild(style);
}
