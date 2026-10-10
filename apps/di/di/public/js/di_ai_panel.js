// AI Assistant side panel: a drawer that lives beside every desk page. On wide screens it
// pushes the page (the content shrinks, nothing is covered); on tablets it slides over the
// page; on phones it takes the screen. It survives route changes, minimises to a small tab
// on the right edge instead of closing, and remembers its state per user. An "AI Assistant"
// launcher sits at the top of every page head.
//
// The chat engine inside talks to di.ai.api and only ever creates DRAFT Sale Tax Invoices.
// Everything the model or the server sends is escaped before it touches the DOM; the small
// markdown renderer below works on escaped text on purpose (no raw HTML from the model).

(function () {
	frappe.provide("di.ai");

	const STORAGE_PREFIX = "di_ai_panel";
	const ROLES = ["System Manager", "DI Panel User", "DI Demo Viewer"];
	const RECOVERY_WINDOW_MS = 90000;
	// Below this width the panel would squeeze the page too much: it overlays instead.
	const PUSH_MIN_WIDTH = 1200;
	const INPUT_MAX_HEIGHT = 160;

	function allowed_user() {
		if (!frappe.session || frappe.session.user === "Guest") {
			return false;
		}
		return ROLES.some((role) => frappe.user.has_role(role));
	}

	// One record per site and user: a shared office browser must not hand the next login the
	// previous user's open chat.
	function storage_key() {
		const boot = frappe.boot || {};
		const user = (frappe.session && frappe.session.user) || (boot.user && boot.user.name) || "";
		return `${STORAGE_PREFIX}:${boot.sitename || window.location.host}:${user}`;
	}

	function read_state() {
		try {
			const raw = localStorage.getItem(storage_key());
			return raw ? JSON.parse(raw) : {};
		} catch (e) {
			return {};
		}
	}

	function write_state(state) {
		try {
			localStorage.setItem(storage_key(), JSON.stringify(state));
		} catch (e) {
			// Private mode or blocked storage: the panel still works, it just forgets.
		}
	}

	function layout_mode() {
		if (window.innerWidth >= PUSH_MIN_WIDTH) {
			return "push";
		}
		return frappe.is_mobile() ? "full" : "overlay";
	}

	const icon = (name, size = "sm") => frappe.utils.icon(name, size);

	// ---------------------------------------------------------------------------
	// The chat engine: renders into any container, knows nothing about the drawer.

	di.ai.Chat = class {
		constructor(container, hooks) {
			this.$container = $(container);
			this.hooks = hooks || {};
			this.conversation = null;
			this.conversations = [];
			this.busy = false;
			this.boot = null;
			this.recovering = false;
			this.pending_invoice = null;
			this.saw_progress = false;
			this.turn_started = null;
			this.timer = null;
			// A later load replaces an earlier one still in flight; stale answers are dropped.
			this.load_token = 0;
			this.view_token = 0;
			this.make();
			this.bind_realtime();
		}

		make() {
			this.$root = $(`
				<div class="di-ai-chat">
					<div class="di-ai-notice" hidden></div>
					<div class="di-ai-draft" hidden></div>
					<div class="di-ai-messages"></div>
					<div class="di-ai-status" hidden>
						<span class="di-ai-dot"></span><span class="di-ai-status-text"></span>
					</div>
					<div class="di-ai-quick" hidden></div>
					<form class="di-ai-form">
						<textarea class="form-control di-ai-input" rows="1"
							placeholder="${__("Ask for an invoice, a buyer, an HS code…")}"></textarea>
						<button type="submit" class="btn btn-primary di-ai-send" title="${__("Send")}" aria-label="${__("Send")}">${icon("send")}</button>
					</form>
					<div class="di-ai-footnote text-muted"></div>
				</div>
			`).appendTo(this.$container);

			this.$notice = this.$root.find(".di-ai-notice");
			this.$draft = this.$root.find(".di-ai-draft");
			this.$messages = this.$root.find(".di-ai-messages");
			this.$status = this.$root.find(".di-ai-status");
			this.$status_text = this.$root.find(".di-ai-status-text");
			this.$quick = this.$root.find(".di-ai-quick");
			this.$form = this.$root.find(".di-ai-form");
			this.$input = this.$root.find(".di-ai-input");
			this.$send = this.$root.find(".di-ai-send");

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
			this.$input.on("input", () => this.fit_input());
			this.render_remaining(null);
		}

		fit_input() {
			const node = this.$input.get(0);
			if (!node) {
				return;
			}
			node.style.height = "auto";
			node.style.height = `${Math.min(node.scrollHeight + 2, INPUT_MAX_HEIGHT)}px`;
		}

		set_input(text) {
			this.$input.val(text);
			this.fit_input();
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
					check_buyer_registration: __("Checking the buyer with FBR"),
					search_tax_items: __("Looking up items"),
					search_hs_codes: __("Searching HS codes"),
					get_hs_code: __("Checking the HS code"),
					lookup_fbr_uom: __("Asking FBR for the UOM"),
					lookup_fbr_rate: __("Asking FBR for the tax rate"),
					lookup_sro_schedules: __("Asking FBR for SRO schedules"),
					lookup_sro_serials: __("Asking FBR for SRO serials"),
					create_tax_item: __("Creating the item"),
					update_tax_item: __("Fixing the item"),
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

		load_bootstrap(invoice, callback) {
			const token = ++this.load_token;
			frappe.call({
				method: "di.ai.api.bootstrap",
				args: { invoice: invoice || null },
				callback: (r) => {
					if (token !== this.load_token) {
						return;
					}
					this.boot = r.message || {};
					this.render_bootstrap();
					this.open_route_invoice(invoice);
					callback && callback(this.boot);
				},
				error: () => {
					if (token !== this.load_token) {
						return;
					}
					this.boot = {
						enabled: false,
						reason: __("The assistant could not be loaded. Close and open it again, or reload the page."),
					};
					this.render_bootstrap();
					callback && callback(this.boot);
				},
			});
		}

		// Opened from an invoice: talk about it when that is possible.
		open_route_invoice(invoice) {
			if (!invoice || !this.boot) {
				return;
			}
			if (this.boot.invoice_error) {
				// show_alert renders HTML and the name in this message came from the caller.
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
					`<div class="di-ai-notice-box">${frappe.utils.escape_html(boot.reason || __("The AI assistant is not available."))}</div>`
				);
				this.$input.prop("disabled", true);
				this.$send.prop("disabled", true);
			} else {
				this.$notice.attr("hidden", true).empty();
				this.$input.prop("disabled", this.busy);
				this.$send.prop("disabled", this.busy);
			}
			this.hooks.on_environment && this.hooks.on_environment(boot.environment);
			this.render_remaining(boot.remaining_today);
			this.render_quick_prompts(boot.quick_prompts || []);
			this.set_conversations(boot.conversations || []);
			if (boot.enabled && !this.conversation && !this.$messages.children().length) {
				this.render_welcome(boot);
			}
		}

		render_remaining(remaining) {
			const $note = this.$root.find(".di-ai-footnote");
			let text = __("Only drafts are created. You review them and press Submit yourself.");
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
			const $welcome = $(`
				<div class="di-ai-welcome">
					<div class="di-ai-welcome-mark">${icon("sparkles", "lg")}</div>
					<h4>${__("What do you want to invoice?")}</h4>
					<p>${__("Write the buyer, items, quantities and prices in Roman Urdu or English. The assistant finds the HS codes, UOMs and rates, saves a draft invoice and tells you what it assumed.")}</p>
					<p class="text-muted di-ai-welcome-sellers">${seller_line}</p>
					<div class="di-ai-suggestions"></div>
				</div>
			`);
			const $cards = $welcome.find(".di-ai-suggestions");
			(boot.quick_prompts || []).forEach((prompt) => {
				$(`<button type="button" class="di-ai-suggestion"><span class="di-ai-suggestion-label"></span><span class="di-ai-suggestion-text text-muted"></span></button>`)
					.find(".di-ai-suggestion-label")
					.text(prompt.label)
					.end()
					.find(".di-ai-suggestion-text")
					.text(prompt.text)
					.end()
					.on("click", () => {
						this.set_input(prompt.text);
						this.$input.trigger("focus");
					})
					.appendTo($cards);
			});
			this.$messages.empty().append($welcome);
			// The suggestion cards replace the chip row while the welcome is shown.
			this.$quick.attr("hidden", true);
		}

		render_quick_prompts(prompts) {
			this.$quick.empty();
			prompts.forEach((prompt) => {
				$(`<button type="button" class="btn btn-default btn-xs di-ai-chip"></button>`)
					.text(prompt.label)
					.attr("title", prompt.text)
					.on("click", () => {
						this.set_input(prompt.text);
						this.$input.trigger("focus");
					})
					.appendTo(this.$quick);
			});
			this.toggle_chips();
		}

		toggle_chips() {
			const welcome = this.$messages.find(".di-ai-welcome").length > 0;
			if (welcome || !this.$quick.children().length) {
				this.$quick.attr("hidden", true);
			} else {
				this.$quick.removeAttr("hidden");
			}
		}

		set_conversations(rows) {
			this.conversations = rows || [];
			if (this.boot) {
				this.boot.conversations = this.conversations;
			}
			this.hooks.on_conversations && this.hooks.on_conversations(this.conversations, this.conversation);
		}

		set_conversation(name) {
			this.conversation = name || null;
			this.hooks.on_conversation && this.hooks.on_conversation(this.conversation);
		}

		refresh_conversations() {
			frappe.call({
				method: "di.ai.api.list_conversations",
				args: { limit: 20 },
				silent: true,
				callback: (r) => this.set_conversations(r.message || []),
				error: () => {},
			});
		}

		open_conversation(name) {
			if (this.busy) {
				return false;
			}
			const token = ++this.view_token;
			frappe.call({
				method: "di.ai.api.get_conversation",
				args: { name },
				callback: (r) => {
					const conv = r.message;
					if (token !== this.view_token || !conv) {
						return;
					}
					this.set_conversation(conv.name);
					this.$messages.empty();
					(conv.messages || []).forEach((m) => this.append_message(m));
					this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
					this.toggle_chips();
					this.refresh_conversations();
					this.scroll_to_end();
					this.$input.trigger("focus");
				},
				error: () => {
					if (token !== this.view_token) {
						return;
					}
					// Gone or not ours any more: start afresh rather than keep a dead reference.
					this.set_conversation(null);
					if (this.boot) {
						this.render_welcome(this.boot);
					}
				},
			});
			return true;
		}

		start_new(invoice) {
			if (this.busy) {
				return false;
			}
			const token = ++this.view_token;
			this.set_conversation(null);
			this.$messages.empty();
			this.render_draft("", "");
			if (invoice) {
				frappe.call({
					method: "di.ai.api.new_conversation",
					args: { invoice },
					callback: (r) => {
						const conv = r.message;
						if (token !== this.view_token || !conv) {
							return;
						}
						this.set_conversation(conv.name);
						this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
						this.$messages.html(
							`<div class="di-ai-welcome di-ai-welcome--compact"><p>${__("Talking about {0}. Ask for changes, an explanation of FBR errors, or a validation.", [frappe.utils.escape_html(invoice)])}</p></div>`
						);
						this.toggle_chips();
						this.refresh_conversations();
						this.$input.trigger("focus");
					},
				});
				return true;
			}
			if (this.boot && this.boot.enabled) {
				this.render_welcome(this.boot);
			}
			this.refresh_conversations();
			this.$input.trigger("focus");
			return true;
		}

		// ---- sending --------------------------------------------------------

		send(preset) {
			const from_box = !preset;
			const text = (preset || this.$input.val() || "").trim();
			if (!text || this.busy || !(this.boot && this.boot.enabled)) {
				return;
			}
			this.$messages.find(".di-ai-welcome").remove();
			this.toggle_chips();
			this.append_message({ role: "user", content: text });
			if (from_box) {
				this.set_input("");
			}
			// Give the typed text back only when it came from the box and the box is still empty.
			const restore = () => {
				if (from_box && !this.$input.val()) {
					this.set_input(text);
				}
			};
			this.saw_progress = false;
			this.recovering = false;
			this.view_token += 1;
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
						this.set_conversation(result.conversation || this.conversation);
						(result.actions || []).forEach((action) =>
							this.append_message({ role: "tool", tool_name: action.tool, ok: action.ok, summary: action.summary })
						);
						this.append_message({ role: "assistant", content: result.reply || "" });
						this.render_draft(result.draft_invoice, result.draft_url, result.draft_environment);
						this.render_remaining(result.remaining_today);
						this.refresh_conversations();
						this.hooks.on_reply && this.hooks.on_reply(result);
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
					// unparsable body). Never leave the chat stuck on "Thinking": fetch the persisted reply.
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
			const deadline = Date.now() + RECOVERY_WINDOW_MS;
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
				this.set_conversation(conv.name);
				this.$messages.empty();
				messages.forEach((m) => this.append_message(m));
				this.render_draft(conv.draft_invoice, conv.draft_url, conv.draft_environment);
				this.refresh_conversations();
				this.hooks.on_reply && this.hooks.on_reply(conv);
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
			const usable = this.boot && this.boot.enabled;
			this.$send.prop("disabled", busy || !usable);
			this.$input.prop("disabled", busy || !usable);
			if (busy) {
				this.$status.removeAttr("hidden");
				this.start_timer();
			} else {
				this.stop_timer();
				this.$status.attr("hidden", true);
				this.scroll_to_end();
				if (this.pending_invoice) {
					const name = this.pending_invoice;
					this.pending_invoice = null;
					this.start_new(name);
				}
			}
			this.hooks.on_busy && this.hooks.on_busy(busy);
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
			const text = (this.status_text || "") + elapsed;
			this.$status_text.text(text);
			this.hooks.on_status && this.hooks.on_status(this.busy ? text : "");
		}

		focus() {
			if (!this.$input.prop("disabled")) {
				this.$input.trigger("focus");
			}
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
					<span class="di-ai-draft-title">${__("Draft")}: <strong class="di-ai-draft-name"></strong> <span class="di-ai-draft-env"></span></span>
					<span class="di-ai-draft-actions">
						<button type="button" class="btn btn-xs btn-default di-ai-validate-draft" ${allow_validate ? "" : "hidden"}>${__("Validate")}</button>
						<button type="button" class="btn btn-xs btn-default di-ai-open-draft">${__("Open")}</button>
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
				this.hooks.on_navigate && this.hooks.on_navigate();
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
					$node.html(di.ai.Chat.render_markdown(message.content || ""));
					// Links in replies (e.g. "Open the draft") move the desk; let the drawer react.
					$node.find("a[href^='/desk/']").on("click", (event) => {
						event.preventDefault();
						this.hooks.on_navigate && this.hooks.on_navigate();
						frappe.set_route($(event.currentTarget).attr("href").replace(/^\/desk\//, ""));
					});
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
	};

	// ---------------------------------------------------------------------------
	// The drawer.

	di.ai.Panel = class {
		constructor() {
			this.state = Object.assign({ open: false, minimized: false, expanded: false, conversation: null }, read_state());
			this.chat = null;
			this.unread = false;
			this.history_open = false;
			this.make();
			this.bind_global();
			this.apply_state();
			if (this.state.open) {
				this.ensure_chat();
				if (!this.state.minimized) {
					this.ensure_chat_loaded();
				}
			}
		}

		make() {
			const is_admin = frappe.user.has_role("System Manager");
			this.$panel = $(`
				<aside class="di-ai-panel" aria-label="${__("AI Assistant")}" hidden>
					<div class="di-ai-panel-head">
						<button type="button" class="di-ai-icon-btn di-ai-history-btn" title="${__("Your chats")}" aria-label="${__("Your chats")}">${icon("history")}</button>
						<div class="di-ai-panel-title">
							<span class="di-ai-panel-logo">${icon("sparkles")}</span>
							<span class="di-ai-panel-name">${__("AI Assistant")}</span>
							<span class="di-ai-panel-env" hidden></span>
						</div>
						<div class="di-ai-panel-tools">
							${is_admin ? `<button type="button" class="di-ai-icon-btn di-ai-settings-btn" title="${__("AI settings")}" aria-label="${__("AI settings")}">${icon("settings")}</button>` : ""}
							<button type="button" class="di-ai-icon-btn di-ai-new-btn" title="${__("New chat")}" aria-label="${__("New chat")}">${icon("message-square-plus")}</button>
							<button type="button" class="di-ai-icon-btn di-ai-expand-btn" title="${__("Wider")}" aria-label="${__("Wider")}">${icon("expand")}</button>
							<button type="button" class="di-ai-icon-btn di-ai-minimize-btn" title="${__("Minimise")}" aria-label="${__("Minimise")}">${icon("minimize-2")}</button>
							<button type="button" class="di-ai-icon-btn di-ai-close-btn" title="${__("Close")}" aria-label="${__("Close")}">${icon("x")}</button>
						</div>
					</div>
					<div class="di-ai-panel-body">
						<div class="di-ai-history" hidden>
							<div class="di-ai-history-head">
								<span>${__("Your chats")}</span>
								<button type="button" class="btn btn-xs btn-default di-ai-history-new">${__("New chat")}</button>
							</div>
							<div class="di-ai-history-list"></div>
						</div>
						<div class="di-ai-chat-host"></div>
					</div>
				</aside>
			`).appendTo(document.body);
			// Minimised: a small tab on the right edge, out of the way of Frappe's toasts.
			this.$tab = $(`
				<button type="button" class="di-ai-tab" hidden title="${__("Open the AI Assistant")}" aria-label="${__("Open the AI Assistant")}">
					<span class="di-ai-tab-icon">${icon("sparkles")}</span>
					<span class="di-ai-tab-text">
						<span class="di-ai-tab-label">${__("AI Assistant")}</span>
						<span class="di-ai-tab-status"></span>
					</span>
				</button>
			`).appendTo(document.body);

			this.$env = this.$panel.find(".di-ai-panel-env");
			this.$history = this.$panel.find(".di-ai-history");
			this.$history_list = this.$panel.find(".di-ai-history-list");
			this.$host = this.$panel.find(".di-ai-chat-host");

			this.$panel.find(".di-ai-history-btn").on("click", () => this.toggle_history());
			this.$panel.find(".di-ai-new-btn, .di-ai-history-new").on("click", () => {
				if (this.chat_busy()) {
					return;
				}
				this.show_history(false);
				this.chat && this.chat.start_new();
			});
			this.$panel.find(".di-ai-settings-btn").on("click", () => {
				this.navigated();
				frappe.set_route("Form", "DI AI Settings");
			});
			this.$panel.find(".di-ai-expand-btn").on("click", () => this.toggle_expand());
			this.$panel.find(".di-ai-minimize-btn").on("click", () => this.minimize());
			this.$panel.find(".di-ai-close-btn").on("click", () => this.close());
			this.$tab.on("click", () => this.restore());
		}

		bind_global() {
			// Forms build their head inside frm.setup(), after "page-change" has fired; the form
			// events come right after it. ensure_launchers() is idempotent.
			$(document).on("page-change form-load form-refresh", () => this.ensure_launchers());
			this.ensure_launchers();
			$(document).on("keydown", (event) => {
				if (event.key === "Escape" && this.is_visible() && this.$panel.find(":focus").length) {
					this.minimize();
				}
			});
			let resize_timer = null;
			$(window).on("resize", () => {
				clearTimeout(resize_timer);
				resize_timer = setTimeout(() => this.apply_state(), 120);
			});
		}

		ensure_launchers() {
			$(".page-head .page-actions").each((_index, node) => {
				const $actions = $(node);
				if ($actions.children(".di-ai-launch").length) {
					return;
				}
				$(`<button type="button" class="btn btn-default btn-sm di-ai-launch" title="${__("Open the AI Assistant")}">${icon("sparkles", "sm")}<span class="di-ai-launch-label">${__("AI Assistant")}</span></button>`)
					.on("click", () => this.toggle())
					.prependTo($actions);
			});
			$(".di-ai-launch").toggleClass("active", this.is_visible());
		}

		// ---- state ----------------------------------------------------------

		save() {
			write_state(this.state);
		}

		is_visible() {
			return this.state.open && !this.state.minimized;
		}

		apply_state() {
			const visible = this.is_visible();
			const mode = layout_mode();
			const expanded = visible && this.state.expanded && mode === "push";
			$(document.body)
				.toggleClass("di-ai-panel-open", visible)
				.toggleClass("di-ai-panel-expanded", expanded)
				.toggleClass("di-ai-mode-push", mode === "push")
				.toggleClass("di-ai-mode-overlay", mode === "overlay")
				.toggleClass("di-ai-mode-full", mode === "full");
			if (visible) {
				this.$panel.removeAttr("hidden");
			} else {
				this.$panel.attr("hidden", true);
			}
			if (this.state.open && this.state.minimized) {
				this.$tab.removeAttr("hidden");
			} else {
				this.$tab.attr("hidden", true);
			}
			this.$tab.toggleClass("has-unread", this.unread);
			this.$panel
				.find(".di-ai-expand-btn")
				.attr("title", this.state.expanded ? __("Narrower") : __("Wider"))
				.html(icon(this.state.expanded ? "shrink" : "expand"));
			$(".di-ai-launch").toggleClass("active", visible);
		}

		ensure_chat() {
			if (this.chat) {
				return this.chat;
			}
			this.chat = new di.ai.Chat(this.$host, {
				on_environment: (environment) => this.render_environment(environment),
				on_conversations: (rows, current) => this.render_history(rows, current),
				on_conversation: (name) => {
					this.state.conversation = name;
					this.save();
				},
				on_busy: (busy) => {
					this.$panel.toggleClass("is-busy", busy);
					this.$tab.toggleClass("is-busy", busy);
					if (!busy) {
						this.$tab.find(".di-ai-tab-status").text("");
					}
				},
				on_status: (text) => this.$tab.find(".di-ai-tab-status").text(text || ""),
				on_reply: () => {
					if (this.state.minimized) {
						// The tab shows a dot; no toast, which would sit on top of the tab.
						this.unread = true;
						this.apply_state();
					}
				},
				on_navigate: () => this.navigated(),
			});
			return this.chat;
		}

		ensure_chat_loaded(invoice) {
			const chat = this.ensure_chat();
			// A disabled or failed bootstrap is retried on every open: the administrator may have
			// switched the assistant on meanwhile, or the network may be back.
			if (chat.boot && chat.boot.enabled && !invoice) {
				return;
			}
			chat.load_bootstrap(invoice, (boot) => {
				const stored = this.state.conversation;
				if (invoice || !stored || chat.conversation || !boot || !boot.enabled) {
					return;
				}
				// Reopen the last chat only when it is one of this user's recent ones.
				if ((boot.conversations || []).some((row) => row.name === stored)) {
					chat.open_conversation(stored);
				} else {
					this.state.conversation = null;
					this.save();
				}
			});
		}

		// ---- actions --------------------------------------------------------

		open(options) {
			const invoice = options && options.invoice;
			this.state.open = true;
			this.state.minimized = false;
			this.unread = false;
			this.save();
			this.apply_state();
			this.ensure_chat_loaded(invoice);
			this.show_history(false);
			setTimeout(() => this.chat && this.chat.focus(), 60);
		}

		toggle() {
			if (this.is_visible()) {
				this.minimize();
			} else {
				this.open();
			}
		}

		minimize() {
			if (!this.state.open) {
				return;
			}
			this.state.minimized = true;
			this.save();
			this.apply_state();
		}

		restore() {
			this.open();
		}

		close() {
			this.state.open = false;
			this.state.minimized = false;
			this.unread = false;
			this.save();
			this.apply_state();
		}

		toggle_expand() {
			this.state.expanded = !this.state.expanded;
			this.save();
			this.apply_state();
		}

		// The panel moved the desk to another page: where it covers the page (tablet, phone),
		// step aside so the user sees where they went.
		navigated() {
			if (layout_mode() !== "push") {
				this.minimize();
			}
		}

		chat_busy() {
			if (this.chat && this.chat.busy) {
				frappe.show_alert({ message: __("Wait for the current answer to finish."), indicator: "orange" });
				return true;
			}
			return false;
		}

		// ---- rendering ------------------------------------------------------

		render_environment(environment) {
			if (!environment) {
				this.$env.attr("hidden", true);
				return;
			}
			const production = environment === "Production";
			this.$env
				.removeAttr("hidden")
				.toggleClass("is-production", production)
				.text(production ? __("Production") : __("Sandbox"))
				.attr("title", production ? __("New drafts are created for FBR Production") : __("New drafts are created for FBR Sandbox"));
		}

		toggle_history() {
			this.show_history(!this.history_open);
		}

		show_history(show) {
			this.history_open = !!show;
			if (this.history_open) {
				this.$history.removeAttr("hidden");
				this.chat && this.chat.refresh_conversations();
			} else {
				this.$history.attr("hidden", true);
			}
			this.$panel.find(".di-ai-history-btn").toggleClass("active", this.history_open);
		}

		render_history(rows, current) {
			this.$history_list.empty();
			if (!rows.length) {
				this.$history_list.append(`<div class="text-muted di-ai-empty">${__("No chats yet")}</div>`);
				return;
			}
			rows.forEach((row) => {
				const $item = $(`
					<button type="button" class="di-ai-conv ${row.name === current ? "active" : ""}">
						<span class="di-ai-conv-title"></span>
						<span class="di-ai-conv-meta text-muted"></span>
					</button>
				`);
				$item.find(".di-ai-conv-title").text(row.title || __("Untitled chat"));
				$item.find(".di-ai-conv-meta").text(
					[row.draft_invoice, frappe.datetime.prettyDate(row.modified)].filter(Boolean).join(" · ")
				);
				$item.on("click", () => {
					if (this.chat_busy()) {
						return;
					}
					this.show_history(false);
					this.chat && this.chat.open_conversation(row.name);
				});
				this.$history_list.append($item);
			});
		}
	};

	// Public entry point for the old page route and anything else that wants the assistant.
	di.ai.open = function (options) {
		if (!di.ai.panel) {
			if (!allowed_user()) {
				frappe.msgprint(__("The AI assistant is available to System Managers and Client Panel users."));
				return;
			}
			di.ai.panel = new di.ai.Panel();
		}
		di.ai.panel.open(options || {});
	};

	$(document).on("app_ready", () => {
		// This script loads on every desk page: a failure here must never take the desk down.
		try {
			if (!allowed_user() || di.ai.panel) {
				return;
			}
			di.ai.panel = new di.ai.Panel();
		} catch (error) {
			console.error("di.ai panel failed to start", error);
		}
	});
})();
