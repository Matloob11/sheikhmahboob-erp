# DI AI Assistant — design

An assistant inside the Digital Invoicing desk that turns a plain-language request
("SUBHAN ENTERPRISES ki University of Education ko 3 water filters 4500 each wali invoice
banao") into a **draft** `Sale Tax Invoice`, doing the lookups a clerk would do: find the
seller, find or create the buyer, find or create the Tax Item, pick the HS code, take the
UOM and rate from FBR's reference data, derive the sale type / scenario, and save the draft.
It never submits and never posts to FBR. A person reviews the draft and presses Submit, and
Submit is what files the invoice.

Revision 3, 2026-10-09: revision 2 followed a five-lens design review (Frappe API, OpenAI API,
security, FBR domain, UX); revision 3 applies the implementation review (page script, FBR domain,
OpenAI protocol, security, Frappe API, tests) and the verification pass that followed it.
Implementation lives next to this file.

## 1. Who uses it, and what they may do

| User | Allowed | Scope |
|---|---|---|
| System Manager | chat, create/update drafts for any seller | all `Seller Or Company` |
| DI Panel User | chat, create/update drafts | sellers from `di.panel.get_allowed_sellers()`; **Production only** |
| DI Demo Viewer | opens the page, sees the "read-only account" notice | nothing |
| everyone else | nothing | refused |

Reads go through `frappe.get_list`, so the `permission_query_conditions` hooks in
`di/panel.py` apply. Document-level checks use `frappe.has_permission(doc=...)`, which runs the
`has_permission` hook. **Create is scoped by the tools, not by the framework**: the hook answers
True for `create` on any seller, so every tool that takes a seller first runs
`tools.require_seller()` (allowed list + the hook's read check), and the write tools also run
`has_permission("write", doc)` on the unsaved document before `insert()`.

Hard limits, enforced in code and stated in the system prompt:

- Never `submit()`, never call post / resync. Only `docstatus == 0` documents are written;
  `update_draft_invoice` applies a closed allow-list of header fields and asserts afterwards that
  the document is still a plain draft with no FBR number.
- Never invent a tax identity. A new Buyer needs NTN (7 digits, or IRIS `1234567-8`) or CNIC
  (13 digits), province and address from the user. Eight bare digits are refused, not guessed.
- Client panel users file on Production only (business rule of 2026-10-08, also enforced by
  `SaleTaxInvoice._enforce_production_for_panel`). A Sandbox request from them is refused by the
  tool so the model has to tell the user; the reported environment is always read back from the
  saved document.
- FBR tokens, the OpenAI key and `site_config` values never reach the model or the client.
  NTN/CNIC values are masked to the last four digits in everything the model sees.

## 2. Pieces

```
apps/di/di/ai/
  DESIGN.md            this file
  config.py            settings + key resolution, model chain, limits
  openai_client.py     Responses API over `requests`: create_response(), list_models(), errors, retries
  rules.py             pure rules: tax ids, provinces, UOM aliases, scenario table, sale-type inference,
                       flat-rupee detection, HS code normalisation, FBR error hints
  hs_search.py         HS Code search (parameterised SQL, word ranking); pure helpers testable without a site
  prompts.py           system prompt (static) + per-turn context (developer message)
  tools.py             tool catalogue: strict JSON schemas + permission-checked implementations
  assistant.py         the turn: lock, budget, build input → call → run tools → persist → reply
  api.py               whitelisted endpoints for the page and the settings form
apps/di/di/digital_invoicing/doctype/
  di_ai_settings/      Single: enabled, model, fallbacks, effort, api_key (Password), limits
  di_ai_conversation/  one chat (owner = user), last_response_id, usage, linked draft
  di_ai_message/       child rows: user / assistant / tool / error messages
apps/di/di/public/js/di_ai_panel.js + public/css/di_ai_panel.css
                       the side panel on every desk page (chat engine + drawer + page-head launcher)
apps/di/di/digital_invoicing/page/di_ai_assistant/
  di_ai_assistant.{json,js}       the old page route; it only opens the panel
apps/di/di/tests/test_ai_*.py     site-less tests (rules, hs_search ranking, client, tool schemas and
                                  pre-checks, assistant loop with a scripted client)
```

Navigation: an "AI Assistant" launcher is prepended to the `.page-actions` of every page head
(on `page-change`, and on `form-load` / `form-refresh` because a form builds its head after
`page-change`), so there is no sidebar item or workspace shortcut (`PAGE_LINKS` is empty, and
`DI AI Conversation` is kept out of the auto-built sidebar). The old route `/desk/di-ai-assistant`
only calls `di.ai.open()`. Layout: at 1200 px and wider the panel is a flex child of `<body>` next
to `.main-section`, so the page shrinks rather than being covered (and "Wider" widens it); from
768 to 1199 px it slides over the right side of the page; below 768 px it takes the screen, and
opening a draft from it minimises it. Open / minimised / wider state and the current conversation
are kept in `localStorage` per site and user, and the stored conversation is reopened only when it
is among the user's recent ones. Minimising keeps the chat alive: a small tab on the right edge
shows the running step and an unread dot when the reply lands (no toast, which would sit on the
tab). Escape minimises. System Managers get a settings button in the panel head.

No new Python dependency: the OpenAI Responses API is called with `requests`.

## 3. Settings (`DI AI Settings`, Single, System Manager only)

| Field | Default | Notes |
|---|---|---|
| enabled | 0 | master switch; the page shows a notice when off |
| model | `gpt-6-astra` | strongest and dearest (about $10 / $50 per million tokens) |
| fallback_models | `gpt-6.1-sol`, `gpt-6-sol`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.5` | tried in order on `model_not_found`; `gpt-6.1-sol` is near-Astra quality at a fifth of the cost and is the pragmatic choice |
| reasoning_effort | medium | low / medium / high / xhigh (every model in the chain accepts these; `none` is never sent) |
| api_key | — | Password; if blank, `frappe.conf.openai_api_key` (read with `raise_exception=False`) |
| store_on_openai | 1 | use `previous_response_id`; OpenAI keeps the chain 30 days; off = replay own history |
| default_environment | Production | System Managers only; panel users are always Production |
| max_tool_rounds | 8 | model → tools → model cycles per turn |
| turn_budget_seconds | 75 (max 90) | each model call gets only the time left; nothing starts with < 10 s |
| max_output_tokens | 8000 | ceiling per call including reasoning tokens |
| daily_messages_per_user | 150 | counted from committed `user` rows across all of the owner's conversations |
| allow_fbr_lookups / allow_fbr_validate | 1 / 1 | the FBR tools disappear from the catalogue when off |
| extra_instructions | — | house rules appended to the system prompt |

"Test connection": lists models visible to the key, marks each model of the chain available or
not, then makes one probe call with the configured effort and a 2048-token cap and reports
`status`, latency and usage (reasoning tokens included). Success is judged on `status ==
"completed"`, not on the length of the reply.

## 4. Conversation storage

`DI AI Conversation` (autoname hash): `title`, `user`, `seller`, `draft_invoice`,
`invoice_context`, `last_response_id`, `model`, `status`, token totals, `last_error`, `messages`.
`DI AI Message`: `role` (user / assistant / tool / error), `content`, `tool_name`, `tool_call_id`,
`tool_args`, `tool_result` (both ≤ 8 kB, so a result trimmed to 6 kB for the model is never cut),
tokens, `duration_ms`, `created_at`.

Permissions: System Manager all; DI Panel User **read with `if_owner` only**. The server writes
conversations with `ignore_permissions` after its own ownership check, so a panel user cannot
edit `invoice_context`, `draft_invoice`, `last_response_id` or the messages through
`frappe.client`. `invoice_context` and `draft_invoice` are re-checked with `has_permission(read)`
every turn before they enter the context, and the daily cap counts committed rows by
conversation **owner**, so neither deletion nor a spoofed `user` field resets it.

## 5. One turn (`di.ai.api.chat(message, conversation=None, invoice=None)`)

1. **Guard**: role (§1); settings enabled; key present; message ≤ 4000 chars; per-user redis lock
   (`SET NX`, TTL = budget + 30 s, site-prefixed) so one user cannot run two turns at once; a
   site-wide count of running turns (`di_ai_max_concurrent_turns` in site config, else gunicorn
   workers − 1; INCR and EXPIRE in one transaction, every acquire refreshes the TTL) so the
   assistant never holds the last worker; a cache failure refuses the turn with a message that
   says so and is committed to Error Log; daily cap.
2. **Conversation**: load (owner or System Manager) or create; the user message is appended and
   committed before the first model call, so it counts even if the turn dies.
3. **Instructions** (stable per user, cacheable): system prompt + house rules + the user's
   sellers, the sale types (with `requires_sro` from `di.constants`), the full scenario table with
   buyer kinds, the UOM list and the provinces. `prompt_cache_key` = the user.
4. **Turn context** (volatile, small): today, user, `ENVIRONMENT`, `fixed_seller`, the invoice in
   context and the current draft (permission-checked), sent as a developer message next to the
   user message.
5. **Input**: with `store_on_openai` and a `last_response_id`: developer + user items chained on
   `previous_response_id`; otherwise the last 20 user/assistant messages are replayed first (the
   user row committed in step 2 is sent once, after the turn context, never twice).
6. **Call** `openai_client.create_response(...)` with the tool catalogue, `tool_choice: auto`,
   `parallel_tool_calls`, `reasoning.effort`, `max_output_tokens`, `store`, connect 10 s and read
   `min(60, time left − 4)`; nothing starts with less than 14 s left. A temporary 429 or 5xx is
   retried once after the `Retry-After` (at most 15 s and never more than the turn can wait; a
   longer `Retry-After` is not retried), with the retry's read timeout cut to what is left; quota
   429s are not retried. `model_not_found` (404, or the 403 a project barred from a model gets)
   moves down the chain; a `failed` status raises.
7. **Tool loop**: every returned `function_call` is answered (executed, or answered with an
   "out of time" error when the budget is gone, so no call_id is left dangling), progress lines
   are published over realtime, and the outputs are sent back chained on the response id (stored
   mode) or appended after the model's own output items, reasoning included (stateless mode).
   A call cut off by the output cap is never executed: when the response holds nothing else
   usable it is abandoned and the same input goes once more with double the cap; otherwise the
   cut call is answered with a "cut off" error (stored mode) or dropped from the replay
   (stateless mode). The stateless replay asks for `reasoning.encrypted_content`, sends the
   reasoning items back with it, drops server-side item ids and any reasoning item left without
   the item it led to. A stale `previous_response_id` is rebuilt from local history only before
   any tool ran; later the turn fails and the next one replays, so the model never forgets a
   write it just made. Write tools commit immediately; per turn at most 6 master/draft writes,
   3 validations and 12 FBR reference lookups.
8. **Wrap-up**: when rounds or time run out, one more call with `tool_choice: "none"` and a
   developer nudge asks for the summary; in stored mode only the still-unanswered tool outputs
   travel with the nudge (everything else is already in the chain). If that call cannot be made,
   the reply is built from the tool log and `last_response_id` is cleared so the next turn
   replays from local history. A refusal is shown as the reply; an `incomplete` answer with no
   text (reasoning ate the cap) is retried once with double the cap, as in step 7.
9. **Persist**: assistant text, tool rows, usage (input / output / cached / reasoning),
   `last_response_id` (cleared when the chain was rebuilt or the largest input exceeded 60k
   tokens, which bounds re-billing), `draft_invoice`. Commit. Lock released in `finally`.
10. **Reply**: `{conversation, reply, draft_invoice, draft_url, draft_environment, actions,
    remaining_today, usage, model}`.

The reply is markdown written by the model in the user's language with a fixed shape (§8).

## 6. Tool catalogue

All tools: strict JSON schema (every property required, `additionalProperties: false`,
optionals as `["string", "null"]`; `update_draft_invoice.set` is a closed object), arguments
re-validated in Python, `ToolError` → `{"ok": false, "error": ...}`, a controller
`ValidationError` → its user-facing text clipped to 400 chars, any other exception → logged to
Error Log and reported to the model as "internal error, logged as <name>" (never the exception
text). Results are trimmed: ≤ 15 rows for buyer / item / rate lists, 25 HS codes, 60 SRO serials,
10 invoices, and ≤ 10 kB of JSON, keeping the draft's name and totals when the rest is cut. When
the user has exactly one seller it is injected into every call, overriding whatever the model wrote.

| Tool | R/W | What it does |
|---|---|---|
| `search_buyers(seller, query)` | R | the seller's buyers plus shared unregistered ones; name or NTN/CNIC match; returns `exact_match` |
| `check_buyer_registration(ntn_cnic, seller)` | R (FBR) | STATL `Get_Reg_Type` with the seller's **production** token (sandbox tokens answer wrongly) |
| `create_buyer(seller, name, registration_type, ntn_cnic, province, address)` | W | validates identity/province, refuses the seller's own NTN (0058), returns an existing match instead of a twin |
| `search_tax_items(seller, query)` | R | the seller's Tax Items; System Managers also see seller-less shared ones (the panel query hook hides those from panel users) |
| `search_hs_codes(query, limit)` / `get_hs_code(hs_code)` | R | word-ranked search; 8 bare digits normalised to NNNN.NNNN |
| `lookup_fbr_uom(hs_code, seller)` | R (FBR) | `pdi/v2/HS_UOM` with the seller's token; caches on `HS Code.uom` only when FBR returns exactly one unit and the user may write HS Code |
| `lookup_fbr_rate(hs_code, uom, sale_type, seller)` | R (FBR) | `pdi/v2/SaleTypeToRate`; transaction type resolved case-insensitively; province from the seller |
| `lookup_sro_schedules(rate_id, seller)` / `lookup_sro_serials(sro_id, seller)` | R (FBR) | 0077 / 0078 data; new schedules are saved to the master only by a user who may write SRO Schedule (as on the desk), everyone else gets the list and a note |
| `create_tax_item(...)` | W | HS exists; the cached `HS Code.uom` is a hint: when the UOM differs, FBR's live HS_UOM list decides (some codes allow several units) and when FBR cannot be asked the item is saved with a 0099 warning; flat rupee rates refused; an FBR literal rate text ("18% along with rupees 60 per kilogram") keeps its wording, its leading percentage is the rate number and it needs an explicit sale type; sale type inferred only when unambiguous (plain 18% → standard, "Exempt" → Exempt goods); standard rate must be a plain 18% |
| `update_tax_item(name, ...)` | W | same checks; clears a stale `rate_id` when the rate or sale type changes; lists the drafts that use the item |
| `list_recent_invoices(seller, buyer, limit)` | R | submitted invoices only; Production only for panel users |
| `get_invoice(name)` | R | summary + warnings |
| `create_draft_invoice(seller, buyer, items, environment, invoice_date, scenario_id)` | W | §7; returns an identical draft (same lines including discount, retail price and SRO fields, same environment and scenario) created in the last 10 minutes instead of a twin |
| `update_draft_invoice(name, set, items)` | W | drafts only; closed `set`; full line replacement |
| `preview_fbr_payload(name)` | R | no network; NTN/CNIC masked |
| `validate_with_fbr(name)` | R (FBR) | drafts only; refuses when the seller lacks the token for the draft's environment; short timeout; writes the DI Log row; returns error codes with next-step hints |

FBR calls go through `di.integrations.http.get/post` with the seller's own token and (3, 8) s
timeouts, never through the DI-Settings-guarded helpers in `reference_api`; at most 12 per turn.

## 7. Draft rules (`create_draft_invoice`)

- `seller` allowed; `buyer` exists, belongs to the seller or is shared, is readable, and does not
  carry the seller's NTN; every `tax_item` exists and belongs to the seller or is shared.
- `environment`: panel users → Production (a Sandbox request is refused with a message for the
  user); administrators → the requested value, else the settings default.
- `invoice_date` = given or today; `invoice_type` = "Sale Invoice".
- Rows: quantity > 0, `sale_rate` > 0, discount ≥ 0. Sale type per row = explicit, else the Tax
  Item's transaction type, else inferred only when unambiguous. Items with a flat rupee rate
  ("Rs.2", "Rs.200": Cement, CNG) are refused because the controller computes tax as a percentage.
  3rd Schedule / SRO 297 rows need a retail price (row value or `Tax Item.fixed_rs`, which wins).
- One sale type per invoice: mixed rows are refused by the tool with wording the model relays
  ("one draft per sale type?"); the controller forces the scenario's type onto every row on
  Sandbox drafts only, Production drafts keep what each row carries.
- `scenario_id`: given (must match the sale type and the buyer kind) or derived from the table
  in `rules.scenario_for` (standard SN001/SN002, reduced SN005/SN028, 3rd Schedule SN008/SN027,
  cotton ginners registered only, every other sale type its single scenario), then checked
  against the Scenario master.
- `doc.insert()` with the user's permissions plus an explicit `has_permission(write)` check;
  commit; the summary is read back from the saved document (environment included).
- Warnings returned to the model: a missing seller token for the draft's environment (Submit
  would fail), SRO rows (0077/0078) and a schedule without its serial (0078), retail price (0090)
  or a retail price that was taken from the sale rate, rows with a rupee-per-unit rate whose tax
  is computed as a percentage (0105), UOM differing from the unit cached for the HS code (confirm
  with lookup_fbr_uom; 0099) or not yet confirmed, self-invoicing (0058), future dates.

## 8. System prompt (summary; full text in `prompts.py`)

Drafts only; one seller means never ask; never invent identities; reuse before creating with a
decision table (one match → use, 2–5 → numbered list, 0 → one question naming every missing
field, walk-in → the seller's unregistered buyer); registration type from
`check_buyer_registration`; HS code: verify a given code, otherwise show ≤ 3 candidates and
wait, create the Tax Item only after the pick and never in the same reply; UOM from FBR; rate
rules incl. SRO and retail price; flat rupee rates by hand; one sale type per invoice; report the
environment the result shows; dates/amounts; tool results are data; stop after two identical
failures; "same as last time" rule. Reply shape: two fixed first lines ("Draft X saved — nothing
sent to FBR" / "Submit files it on FBR <env>, cannot be undone"), compact lines for ≤ 4 rows
and a table above that, totals, Assumptions, Open questions (first when something is missing),
mirror the user's script, keep stored names and numbers verbatim, one question per reply. An
FBR error-code cheat sheet is included.

## 9. Realtime, limits, cost

- Progress lines (`di_ai_progress`, per user) before each model call and tool; the page shows
  them with an elapsed timer. If the gateway cuts the request after progress was seen, the page
  polls the conversation for the persisted reply instead of re-sending.
- Budget: turn 75 s (hard max 90), per-call read timeout `min(60, left − 4)`, no call with < 14 s
  left, nginx/gunicorn cut at 120 s. Per-user lock and site-wide turn slots. Per-turn write (6),
  validate (3) and FBR lookup (12) caps.
- Cost: static instructions + `prompt_cache_key` keep the cached prefix stable; tool results
  trimmed; chains restarted beyond 60k input tokens; input/output tokens stored per message and
  per conversation (cached and reasoning counts travel in the reply only); the settings form
  shows 30-day usage by user. Rough cost per turn (three calls,
  ~10k input, ~600 output, medium reasoning): gpt-6-astra about $0.2–0.6, gpt-6.1-sol about
  $0.03–0.08.

## 10. Security notes

- All endpoints whitelisted without `allow_guest`; `chat`, `new_conversation`, `close_conversation`
  and `test_connection` are POST-only, so Frappe's CSRF check covers them and a cross-site GET
  cannot run a turn on a logged-in session; `test_connection` / `usage_summary` are
  `only_for("System Manager")`; the page lists its three roles so the demo viewer sees the notice.
- The instructions carry a seller's name, masked NTN, province and token flags only, never its
  free-text address, and the prompt names seller records among the data the model must not take
  instructions from; `HS Code` and `SRO Schedule` are written only by users who may write them.
- Text that reaches `msgprint` / `show_alert` from a client-supplied value (the invoice name in
  the route) is HTML-escaped on the server and in the page.
- Seller scoping is enforced in the tools (§1); the parallel `di-fixes` work hardens the
  `has_permission` hook for `create` and for stored sellers on write, which closes the same path
  for direct REST calls.
- Prompt injection through master data can at worst produce a wrong draft or spend the user's
  own seller token on lookups, bounded by the per-turn caps; the model is told tool results are
  data, and buyer/item names containing `<`/`>` are refused by the tools.
- Error text never carries internals: OpenAI errors are scrubbed of key-like strings, FBR errors
  are the house `http.py` messages, unexpected exceptions become an Error Log reference.
- OpenAI retains stored chains for 30 days (tool results carry buyer names and masked ids);
  `store_on_openai` can be switched off for a zero-data-retention account.
- Nothing in this feature changes the FBR posting path; the AI's "never posts" property is its
  own, while the pre-existing unguarded `di.api.post_sale_tax_invoice` is closed by `di-fixes` P0-1.

## 11. Deployment

1. `./ops/push-app.sh di` (migrate creates the three DocTypes and the Page; navigation adds the links).
2. `./ops/set-openai-key.sh <file holding the key>` (or `bench --site sheikhmahboob.com set-config
   openai_api_key '<new key>'` as the frappe user), then on `DI AI Settings`: tick Enabled, press
   "Test connection", keep or change the model; wait about a minute after `set-config` first, the
   site config is cached per worker. Optional: `set-config di_ai_max_concurrent_turns 2` (default
   is gunicorn workers − 1).
3. As Administrator: open `/desk/di-ai-assistant`, create a Sandbox draft for DEMO TRADERS, open
   it, confirm nothing was submitted. As a panel user: create a Production draft for their own
   seller, confirm it stays a draft, then delete it as Administrator.

## 12. Out of scope for the first version

Voice input, file/PDF reading, bulk CSV invoices, submitting on the user's behalf, Debit Notes
(waits for P1-1), flat rupee-per-unit rates (waits for a controller change), the ERPNext Sales
Invoice path, WhatsApp channel, a background-job turn (would remove the 120 s ceiling).
