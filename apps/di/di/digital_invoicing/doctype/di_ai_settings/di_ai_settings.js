frappe.ui.form.on("DI AI Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Test connection"), () => di_ai_test_connection(frm));
		frm.add_custom_button(__("Open assistant"), () => frappe.set_route("di-ai-assistant"));
		di_ai_render_usage(frm);
	},
});

function di_ai_test_connection(frm) {
	if (frm.is_dirty()) {
		frappe.msgprint(__("Save the settings first, then test the connection."));
		return;
	}
	frappe.dom.freeze(__("Contacting OpenAI..."));
	frappe
		.xcall("di.ai.api.test_connection")
		.then((result) => {
			frappe.dom.unfreeze();
			const esc = frappe.utils.escape_html;
			const chain = (result.chain || [])
				.map(
					(row) =>
						`<li>${esc(row.model)} ${row.available ? '<span class="indicator-pill green">available</span>' : '<span class="indicator-pill red">not visible to this key</span>'}</li>`
				)
				.join("");
			const visible = (result.gpt_models || []).map(esc).join(", ");
			let body = `<p>${__("Models visible to this key")}: ${result.models_visible}</p>`;
			body += `<ul>${chain}</ul>`;
			if (result.selected_model) {
				body += `<p>${__("Will use")}: <b>${esc(result.selected_model)}</b></p>`;
			}
			if (result.reply) {
				body += `<p>${__("Probe reply")}: <code>${esc(result.reply)}</code> (${result.call_latency_ms} ms)</p>`;
			}
			if (result.warning) {
				body += `<p class="text-danger">${esc(result.warning)}</p>`;
			}
			if (visible) {
				body += `<p class="text-muted small">${__("GPT models on this key")}: ${visible}</p>`;
			}
			frappe.msgprint({
				title: __("OpenAI connection"),
				indicator: result.reply ? "green" : "orange",
				message: body,
			});
		})
		.catch(() => frappe.dom.unfreeze());
}

function di_ai_render_usage(frm) {
	const $wrapper = frm.fields_dict.status_html && frm.fields_dict.status_html.$wrapper;
	if (!$wrapper) {
		return;
	}
	frappe
		.xcall("di.ai.api.usage_summary", { days: 30 })
		.then((summary) => {
			const esc = frappe.utils.escape_html;
			const by_user = (summary.by_user || [])
				.map(
					(row) =>
						`<tr><td>${esc(row.user)}</td><td class="text-right">${row.turns}</td><td class="text-right">${row.input_tokens || 0}</td><td class="text-right">${row.output_tokens || 0}</td></tr>`
				)
				.join("");
			const total_turns = (summary.by_day || []).reduce((n, row) => n + (row.turns || 0), 0);
			$wrapper.html(`
				<p class="text-muted">${__("Last {0} days: {1} assistant replies.", [summary.days, total_turns])}
				${__("Key source: DI AI Settings override if set, else openai_api_key in site_config.json. The key is never shown.")}</p>
				<table class="table table-sm table-bordered">
					<thead><tr><th>${__("User")}</th><th class="text-right">${__("Replies")}</th><th class="text-right">${__("Input tokens")}</th><th class="text-right">${__("Output tokens")}</th></tr></thead>
					<tbody>${by_user || `<tr><td colspan="4" class="text-muted">${__("No usage yet")}</td></tr>`}</tbody>
				</table>
			`);
		})
		.catch(() => {
			$wrapper.html(`<p class="text-muted">${__("Usage will appear here after the first conversation.")}</p>`);
		});
}
