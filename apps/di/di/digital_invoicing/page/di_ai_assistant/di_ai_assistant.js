// AI Assistant page: a chat that turns plain-language requests into DRAFT
// Sale Tax Invoices through di.ai.api. Everything the model or the server sends
// is escaped before it touches the DOM; the small markdown renderer below works
// on escaped text on purpose (no raw HTML from the model, ever).

frappe.pages["di-ai-assistant"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("AI Assistant"),
		single_column: true,
	});
	frappe.breadcrumbs.add("Digital Invoicing");
	wrapper.di_ai = new DIAIAssistant(page, wrapper);
};

frappe.pages["di-ai-assistant"].on_page_show = function (wrapper) {
	if (wrapper.di_ai) {
		wrapper.di_ai.handle_route_options();
	}
};

class DIAIAssistant {
	constructor(page, wrapper) {
		this.page = page;
		this.wrapper = wrapper;
		this.conversation = null;
		this.busy = false;
		this.boot = null;
		this.recovering = false;
		this.pending_invoice = null;
		this.saw_progress = false;
		this.turn_started = null;
		this.timer = null;
		this.make();
		this.bind_realtime();
		this.load_bootstrap();
	}

	// ---- layout ---------------------------------------------------------

	make() {
		this.$root = $(`
			<div class="di-ai">
				<aside class="di-ai-side">
					<button type="button" class="btn btn-primary btn-sm di-ai-new">${__("New chat")}</button>
					<div class="di-ai-conv-list"></div>
				</aside>
				<section class="di-ai-chat">
					<div class="di-ai-notice" hidden></div>
					<div class="di-ai-draft" hidden></div>
					<div class="di-ai-messages"></div>
					<div class="di-ai-status" hidden>
						<span class="di-ai-dot"></span><span class="di-ai-status-text"></span>
					</div>
					<div class="di-ai-quick"></div>
					<form class="di-ai-form">
						<textarea class="form-control di-ai-input" rows="2"
							placeholder="${__("Example: SUBHAN ENTERPRISES ki University of Education ko 3 water filters @ 4500 ki invoice banao")}"></textarea>
						<button type="submit" class="btn btn-primary di-ai-send">${__("Send")}</button>
					</form>
					<div class="di-ai-footnote text-muted">${__("The assistant only creates drafts. You review and submit.")}</div>
				</section>
			</div>
		`).appendTo(this.page.body.addClass("no-border"));

		this.$list = this.$root.find(".di-ai-conv-list");
		this.$notice = this.$root.find(".di-ai-notice");
		this.$draft = this.$root.find(".di-ai-draft");
		this.$messages = this.$root.find(".di-ai-messages");
		this.$status = this.$root.find(".di-ai-status");
		this.$status_text = this.$root.find(".di-ai-status-text");
		this.$quick = this.$root.find(".di-ai-quick");
		this.$form = this.$root.find(".di-ai-form");
		this.$input = this.$root.find(".di-ai-input");
		this.$send = this.$root.find(".di-ai-send");

		this.$root.find(".di-ai-new").on("click", () => this.start_new());
		this.$form.on("submit", (event) => {
			event.preventDefault();
			this.send();
		});
		this.$input.on("keydown", (event) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				this.send();
			}
		});

		if (frappe.user.has_role("System Manager")) {
			this.page.add_inner_button(__("Settings"), () => frappe.set_route("Form", "DI AI Settings"));
		}
		this.page.add_inner_button(__("Sale Invoices"), () => frappe.set_route("List", "Sale Tax Invoice"));
	}

	bind_realtime() {
		if (!frappe.realtime || !frappe.realtime.on) {
			return;
		}
		frappe.realtime.on("di_ai_progress", (data) => {
			if (!this.busy || !data) {
				return;
			}
			if (this.conversation && data.conversation && data.conversation !== this.conversation) {
				return;
			}
			this.saw_progress = true;
			this.set_status(this.describe_step(data));
		});
	}

	describe_step(data) {
		if (data.step === "tool") {
			const labels = {
				search_buyers: __("Looking up buyers"),
				create_buyer: __("Creating the buyer"),
				search_tax_items: __("Looking up items"),
				search_hs_codes: __("Searching HS codes"),
				get_hs_code: __("Checking the HS code"),
				lookup_fbr_uom: __("Asking FBR for the UOM"),
				lookup_fbr_rate: __("Asking FBR for the tax rate"),
				lookup_sro_schedules: __("Asking FBR for SRO schedules"),
				lookup_sro_serials: __("Asking FBR for SRO serials"),
				create_tax_item: __("Creating the item"),
				list_recent_invoices: __("Reading recent invoices"),
				get_invoice: __("Reading the invoice"),
				create_draft_invoice: __("Creating the draft invoice"),
				update_draft_invoice: __("Updating the draft"),
				preview_fbr_payload: __("Building the FBR payload"),
				validate_with_fbr: __("Validating with FBR"),
			};
			return labels[data.detail] || __("Working: {0}", [data.detail || ""]);
		}
		if (data.step === "done") {
			return __("Finishing");
		}
		return data.detail || __("Thinking");
	}

	// ---- data -----------------------------------------------------------

	load_bootstrap() {
		const invoice = this.take_route_invoice();
		frappe.call({
			method: "di.ai.api.bootstrap",
			args: { invoice: invoice || null },
			callback: (r) => {
				this.boot = r.message || {};
				this.render_bootstrap();
				this.open_route_invoice(invoice);
			},
			error: () => {
				this.boot = {
					enabled: false,
					reason: __("The assistant could not be loaded. Reload the page or try again later."),
				};
				this.render_bootstrap();
			},
		});
	}

	take_route_invoice() {
		const options = frappe.route_options || {};
		const invoice = options.invoice;
		if (invoice) {
			frappe.route_options = null;
		}
		return invoice;
	}

	handle_route_options() {
		const invoice = this.take_route_invoice();
		if (!invoice || !this.boot) {
			return;
		}
		frappe.call({
			method: "di.ai.api.bootstrap",
			args: { invoice },
			callback: (r) => {
				this.boot = r.message || this.boot;
				this.render_bootstrap();
				this.open_route_invoice(invoice);
			},
			error: () => {},
		});
	}

	// The page was opened from an invoice: talk about it when that is possible.
	open_route_invoice(invoice) {
		if (!invoice || !this.boot) {
			return;
		}
		if (this.boot.invoice_error) {
			// show_alert renders HTML and the name in this message came from the URL.
			frappe.show_alert({ message: frappe.utils.escape_html(this.boot.invoice_error), indicator: "orange" });
			return;
		}
		if (this.boot.enabled && this.boot.invoice) {
			if (this.busy) {
				// A turn is running; the chat about this invoice starts when it ends.
				this.pending_invoice = this.boot.invoice.name;
				return;
			}
			this.start_new(this.boot.invoice.name);
		}
	}

	render_bootstrap() {
		const boot = this.boot || {};
		if (!boot.enabled) {
			this.$notice.removeAttr("hidden").html(
				`<div class="alert alert-warning">${frappe.utils.escape_html(boot.reason || __("The AI assistant is not available."))}</div>`
			);
			this.$input.prop("disabled", true);
			this.$send.prop("disabled", true);
		} else {
			this.$notice.attr("hidden", true).empty();
			this.$input.prop("disabled", false);
			this.$send.prop("disabled", false);
		}
		this.render_environment(boot.environment);
		this.render_remaining(boot.remaining_today);
		this.render_quick_prompts(boot.quick_prompts || []);
		this.render_conversations(boot.conversations || []);
		if (boot.enabled && !this.conversation && !this.$messages.children().length) {
			this.render_welcome(boot);
		}
	}

	render_environment(environment) {
		if (!environment) {
			return;
		}
		// Same colours as the Sale Tax Invoice list: red for Production, orange for Sandbox.
		this.page.set_indicator(
			environment === "Production" ? __("Drafts: Production") : __("Drafts: Sandbox"),
			environment === "Production" ? "red" : "orange"
		);
	}

	render_remaining(remaining) {
		const $note = this.$root.find(".di-ai-footnote");
		let text = __("The assistant only creates drafts. You review and submit; Submit files with FBR.");
		if (remaining !== null && remaining !== undefined && remaining < 20) {
			text += " " + __("Messages left today: {0}.", [remaining]);
		}
		$note.text(text);
	}

	render_welcome(boot) {
		const sellers = (boot.sellers || []).map((s) => frappe.utils.escape_html(s));
		const seller_line = sellers.length
			? __("Sellers you can invoice for: {0}", [sellers.join(", ")])
			: __("No Seller / Company is assigned to you yet.");
		this.$messages.html(`
			<div class="di-ai-welcome">
				<h4>${__("What do you want to invoice?")}</h4>
				<p>${__("Write the seller, buyer, items, quantities and prices in Roman Urdu or English. The assistant finds the HS codes, UOMs and rates, creates a draft invoice, and shows you what it assumed.")}</p>
				<p class="text-muted">${seller_line}</p>
			</div>
		`);
	}

	render_quick_prompts(prompts) {
		this.$quick.empty();
		prompts.forEach((prompt) => {
			$(`<button type="button" class="btn btn-default btn-xs di-ai-chip"></button>`)
				.text(prompt.label)
				.attr("title", prompt.text)
				.on("click", () => {
					this.$input.val(prompt.text).trigger("focus");
				})
				.appendTo(this.$quick);
		});
	}

	render_conversations(rows) {
		this.$list.empty();
		if (!rows.length) {
			this.$list.append(`<div class="text-muted di-ai-empty">${__("No chats yet")}</div>`);
			return;
		}
		rows.forEach((row) => {
			const $item = $(`
				<button type="button" class="di-ai-conv ${row.name === this.conversation ? "active" : ""}">
					<span class="di-ai-conv-title"></span>
					<span class="di-ai-conv-meta text-muted"></span>
				</button>
			`);
			$item.find(".di-ai-conv-title").text(row.title || __("Untitled chat"));
			$item.find(".di-ai-conv-meta").text(
				[row.draft_invoice, frappe.datetime.prettyDate(row.modified)].filter(Boolean).join(" · ")
			);
			$item.on("click", () => this.open_conversation(row.name));
			this.$list.append($item);
		});
	}

	refresh_conversations() {
		frappe.call({
			method: "di.ai.api.list_conversations",
			args: { limit: 20 },
			silent: true,
			callback: (r) => {
				const rows = r.message || [];
				if (this.boot) {
					this.boot.conversations = rows;
				}
				this.render_conversations(rows);
			},
			error: () => {},
		});
	}

	open_conversation(name) {
		if (this.busy) {
			return;
		}
		frappe.call({
			method: "di.ai.api.get_conversation",
			args: { name },
			callback: (r) => {
				const conv = r.message;
				if (!conv) {
					return;
				}
				this.conversation = conv.name;
				this.$messages.empty();
				(conv.messages || []).forEach((m) => this.append_message(m));
				this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
				this.refresh_conversations();
				this.scroll_to_end();
				this.$input.trigger("focus");
			},
		});
	}

	start_new(invoice) {
		if (this.busy) {
			return;
		}
		this.conversation = null;
		this.$messages.empty();
		this.render_draft("", "");
		if (invoice) {
			frappe.call({
				method: "di.ai.api.new_conversation",
				args: { invoice },
				callback: (r) => {
					const conv = r.message;
					if (!conv) {
						return;
					}
					this.conversation = conv.name;
					this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
					this.$messages.html(
						`<div class="di-ai-welcome"><p>${__("Talking about {0}. Ask for changes, an explanation of FBR errors, or a validation.", [frappe.utils.escape_html(invoice)])}</p></div>`
					);
					this.refresh_conversations();
					this.$input.trigger("focus");
				},
			});
			return;
		}
		if (this.boot) {
			this.render_welcome(this.boot);
		}
		this.refresh_conversations();
		this.$input.trigger("focus");
	}

	// ---- sending --------------------------------------------------------

	send(preset) {
		const from_box = !preset;
		const text = (preset || this.$input.val() || "").trim();
		if (!text || this.busy || !(this.boot && this.boot.enabled)) {
			return;
		}
		this.$messages.find(".di-ai-welcome").remove();
		this.append_message({ role: "user", content: text });
		if (from_box) {
			this.$input.val("");
		}
		// Give the typed text back only when it came from the box and the box is still empty.
		const restore = () => {
			if (from_box && !this.$input.val()) {
				this.$input.val(text);
			}
		};
		this.saw_progress = false;
		this.recovering = false;
		const started = Date.now();
		this.turn_started = started;
		this.set_busy(true);
		this.set_status(__("Thinking"));

		frappe.call({
			method: "di.ai.api.chat",
			args: { message: text, conversation: this.conversation || null },
			callback: (r) => {
				try {
					const result = r.message || {};
					this.conversation = result.conversation || this.conversation;
					(result.actions || []).forEach((action) =>
						this.append_message({ role: "tool", tool_name: action.tool, ok: action.ok, summary: action.summary })
					);
					this.append_message({ role: "assistant", content: result.reply || "" });
					this.render_draft(result.draft_invoice, result.draft_url, result.draft_environment);
					this.render_remaining(result.remaining_today);
					this.refresh_conversations();
				} finally {
					this.set_busy(false);
				}
			},
			error: (r) => {
				const refused = r && (r._server_messages || r.exc_type);
				if (this.saw_progress && !refused) {
					// The server kept working after the gateway closed the request.
					// The reply is persisted on the conversation; fetch it instead of re-sending.
					this.recover_reply(restore);
					return;
				}
				// A server message (417) means nothing is running for this message: a progress
				// event seen meanwhile came from another tab of the same user.
				this.append_message({ role: "error", content: __("The assistant could not answer. See the message above, then try again.") });
				restore();
				this.set_busy(false);
			},
			always: () => {
				// request.js skips both callbacks on a few paths (an exception it reports itself, an
				// unparsable body). Never leave the page stuck on "Thinking": fetch the persisted reply.
				setTimeout(() => {
					if (this.busy && this.turn_started === started && !this.recovering) {
						this.recover_reply(restore);
					}
				}, 0);
			},
		});
	}

	recover_reply(restore) {
		this.recovering = true;
		this.set_status(__("Still working, fetching the answer"));
		const deadline = Date.now() + 90000;
		let wait = 3000;
		const finish = (message) => {
			if (message) {
				this.append_message({ role: "error", content: message });
				restore && restore();
			}
			this.recovering = false;
			this.set_busy(false);
		};
		const done = (conv) => {
			if (!conv) {
				return false;
			}
			const messages = conv.messages || [];
			const last = messages[messages.length - 1];
			if (!last || last.role === "user") {
				return false;
			}
			this.conversation = conv.name;
			this.$messages.empty();
			messages.forEach((m) => this.append_message(m));
			this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
			this.refresh_conversations();
			finish("");
			return true;
		};
		const later = () => {
			if (Date.now() > deadline) {
				finish(__("The answer did not arrive in time. Open the chat again in a minute; the draft, if any, is saved."));
				return;
			}
			setTimeout(attempt, wait);
			wait = Math.min(wait + 3000, 10000);
		};
		let misses = 0;
		const failed = (r) => {
			// A server message (417: not found, another user's chat) is final; a gateway error is
			// not, but request.js hands 403/404 over without a payload, so repeated misses end it too.
			misses += 1;
			if ((r && (r._server_messages || r.exc_type)) || misses >= 6) {
				finish(__("The answer could not be fetched. Open the chat again in a minute; the draft, if any, is saved."));
				return;
			}
			later();
		};
		const fetch_conversation = (name) => {
			frappe.call({
				method: "di.ai.api.get_conversation",
				args: { name },
				silent: true,
				callback: (r) => {
					misses = 0;
					if (!done(r.message)) {
						later();
					}
				},
				error: failed,
			});
		};
		const attempt = () => {
			if (this.conversation) {
				fetch_conversation(this.conversation);
				return;
			}
			frappe.call({
				method: "di.ai.api.list_conversations",
				args: { limit: 1 },
				silent: true,
				callback: (r) => {
					const latest = (r.message || [])[0];
					if (latest) {
						fetch_conversation(latest.name);
					} else {
						later();
					}
				},
				error: failed,
			});
		};
		setTimeout(attempt, 2000);
	}

	set_busy(busy) {
		this.busy = busy;
		this.$send.prop("disabled", busy);
		this.$input.prop("disabled", busy);
		if (busy) {
			this.$status.removeAttr("hidden");
			this.start_timer();
		} else {
			this.stop_timer();
			this.$status.attr("hidden", true);
			this.$input.trigger("focus");
			this.scroll_to_end();
			if (this.pending_invoice) {
				const name = this.pending_invoice;
				this.pending_invoice = null;
				this.start_new(name);
			}
		}
	}

	start_timer() {
		this.stop_timer();
		this.timer = setInterval(() => this.render_status(), 1000);
	}

	stop_timer() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	set_status(text) {
		this.status_text = text || "";
		this.render_status();
	}

	render_status() {
		let elapsed = "";
		if (this.turn_started) {
			const seconds = Math.floor((Date.now() - this.turn_started) / 1000);
			elapsed = ` (${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")})`;
		}
		this.$status_text.text((this.status_text || "") + elapsed);
	}

	// ---- rendering ------------------------------------------------------

	render_draft(name, _url, environment) {
		if (!name) {
			this.$draft.attr("hidden", true).empty();
			return;
		}
		const allow_validate = this.boot && this.boot.allow_validate;
		const $card = $(`
			<div class="di-ai-draft-card">
				<span>${__("Draft invoice")}: <strong class="di-ai-draft-name"></strong> <span class="di-ai-draft-env"></span></span>
				<span class="di-ai-draft-actions">
					<button type="button" class="btn btn-sm btn-default di-ai-validate-draft" ${allow_validate ? "" : "hidden"}>${__("Validate with FBR")}</button>
					<button type="button" class="btn btn-sm btn-primary di-ai-open-draft">${__("Open draft")}</button>
				</span>
			</div>
		`);
		$card.find(".di-ai-draft-name").text(name);
		if (environment) {
			$card
				.find(".di-ai-draft-env")
				.addClass(`indicator-pill ${environment === "Production" ? "red" : "orange"}`)
				.text(environment);
		}
		$card.toggleClass("di-ai-draft-card--production", environment === "Production");
		$card.find(".di-ai-open-draft").on("click", () => {
			frappe.set_route("Form", "Sale Tax Invoice", name);
		});
		$card.find(".di-ai-validate-draft").on("click", () => {
			this.send(__("Validate draft {0} with FBR and explain any errors", [name]));
		});
		this.$draft.removeAttr("hidden").empty().append($card);
	}

	append_message(message) {
		const role = message.role || "assistant";
		let $node;
		if (role === "tool") {
			$node = $(`<div class="di-ai-tool"><span class="di-ai-tool-icon"></span><span class="di-ai-tool-name"></span><span class="di-ai-tool-summary text-muted"></span></div>`);
			$node.find(".di-ai-tool-icon").text(message.ok === false ? "✗" : "✓");
			$node.toggleClass("di-ai-tool-failed", message.ok === false);
			$node.find(".di-ai-tool-name").text(this.describe_step({ step: "tool", detail: message.tool_name }));
			$node.find(".di-ai-tool-summary").text(message.summary || "");
		} else if (role === "error") {
			$node = $(`<div class="di-ai-msg di-ai-msg-error"></div>`).text(message.content || "");
		} else {
			$node = $(`<div class="di-ai-msg di-ai-msg-${role === "user" ? "user" : "assistant"}"></div>`);
			if (role === "user") {
				$node.text(message.content || "");
			} else {
				$node.html(DIAIAssistant.render_markdown(message.content || ""));
			}
		}
		this.$messages.append($node);
		this.scroll_to_end();
	}

	scroll_to_end() {
		const node = this.$messages.get(0);
		if (node) {
			node.scrollTop = node.scrollHeight;
		}
	}

	// Escape first, then add structure. Supports headings, paragraphs, bold,
	// inline code, fenced code, bullet and numbered lists, pipe tables and
	// links to http(s) or /desk paths. Anything else stays literal text.
	static render_markdown(text) {
		const esc = (value) => frappe.utils.escape_html(String(value == null ? "" : value));
		const inline = (value) => {
			let out = esc(value);
			// escape_html has already turned every backtick into &#x60;.
			out = out.replace(/&#x60;(.+?)&#x60;/g, "<code>$1</code>");
			out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
			out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/desk\/)[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
			return out;
		};
		const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
		const html = [];
		let i = 0;
		const is_table_row = (line) => /^\s*\|.*\|\s*$/.test(line);
		// GFM allows one dash per delimiter cell ("|-|-|"), and models write it that way.
		const is_separator = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);
		while (i < lines.length) {
			const line = lines[i];
			if (/^\s*```/.test(line)) {
				const buffer = [];
				i += 1;
				while (i < lines.length && !/^\s*```/.test(lines[i])) {
					buffer.push(esc(lines[i]));
					i += 1;
				}
				i += 1;
				html.push(`<pre>${buffer.join("\n")}</pre>`);
				continue;
			}
			if (is_table_row(line) && i + 1 < lines.length && is_separator(lines[i + 1])) {
				const cells = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim()));
				const head = cells(line);
				i += 2;
				const body = [];
				while (i < lines.length && is_table_row(lines[i])) {
					body.push(cells(lines[i]));
					i += 1;
				}
				html.push(
					`<div class="di-ai-table-wrap"><table class="table table-bordered table-sm di-ai-table"><thead><tr>${head
						.map((c) => `<th>${c}</th>`)
						.join("")}</tr></thead><tbody>${body
						.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
						.join("")}</tbody></table></div>`
				);
				continue;
			}
			const heading = line.match(/^\s*(#{1,4})\s+(.*)$/);
			if (heading) {
				const level = Math.min(heading[1].length + 3, 6);
				html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
				i += 1;
				continue;
			}
			if (/^\s*[-*•]\s+/.test(line)) {
				const items = [];
				while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
					items.push(`<li>${inline(lines[i].replace(/^\s*[-*•]\s+/, ""))}</li>`);
					i += 1;
				}
				html.push(`<ul>${items.join("")}</ul>`);
				continue;
			}
			if (/^\s*\d+[.)]\s+/.test(line)) {
				const items = [];
				while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
					items.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
					i += 1;
				}
				html.push(`<ol>${items.join("")}</ol>`);
				continue;
			}
			if (!line.trim()) {
				i += 1;
				continue;
			}
			const paragraph = [];
			while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s)/.test(lines[i]) && !is_table_row(lines[i])) {
				paragraph.push(inline(lines[i]));
				i += 1;
			}
			if (!paragraph.length) {
				// A pipe-looking line that did not start a table (no separator row after it) is
				// plain text; always advance, or this loop never ends.
				paragraph.push(inline(line));
				i += 1;
			}
			html.push(`<p>${paragraph.join("<br>")}</p>`);
		}
		return html.join("");
	}
}
