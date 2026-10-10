// The AI assistant lives in the side panel (di/public/js/di_ai_panel.js), which is
// available on every desk page. This route stays for old links and for the
// "?invoice=" hand-off: it opens the panel and shows where it went.

frappe.pages["di-ai-assistant"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("AI Assistant"),
		single_column: true,
	});
	frappe.breadcrumbs.add("Digital Invoicing");
	$(`
		<div class="di-ai-page-note" style="padding: 24px; max-width: 640px;">
			<h4 style="margin-top: 0;">${__("The assistant is now a side panel")}</h4>
			<p>${__("Press the AI Assistant button at the top of any page to open it. It stays open while you move between invoices, buyers and items, and it can be minimised instead of closed.")}</p>
			<button type="button" class="btn btn-primary btn-sm di-ai-page-open">${__("Open the AI Assistant")}</button>
		</div>
	`).appendTo(page.body);
	page.body.find(".di-ai-page-open").on("click", () => {
		if (window.di && di.ai && di.ai.open) {
			di.ai.open();
		}
	});
};

frappe.pages["di-ai-assistant"].on_page_show = function () {
	const options = frappe.route_options || {};
	const invoice = options.invoice;
	if (invoice) {
		frappe.route_options = null;
	}
	if (window.di && di.ai && di.ai.open) {
		di.ai.open(invoice ? { invoice } : {});
	}
};
