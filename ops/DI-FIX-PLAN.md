# DI fix plan (di-fixes)

Ordered task list from `ops/CURSOR-DI-FIX-PROMPT.md`. One commit per task. Suite gate: `ops/run-tests-wsl.sh`.

## Done

| Task | Approach | Risk |
|---|---|---|
| Step 0a–c | Branch `di-fixes`, baseline commit, `scoped_user` patches → `Ran 193 OK (skipped=4)` | Low |

## P0 — security / correctness

### P0-1 Whitelist + scoping + filed fields
- **Files:** `api/__init__.py`, `panel.py`, `sale_tax_invoice.json`/`.py`, `buyer.py`, `reference_api.py`, `statl.py`, `tax_item.py`, `di_api.py`, `sale_tax_invoice_api.py`, `custom_fields.py`, `seller_credentials.py` (new), JS tax_item / STI SRO callers, `tests/test_api_guards.py` (new) + panel create tests
- **Approach:** `has_permission(doc=)` on every mutating whitelist; refuse second post; SM-only `clear_fbr_invoice_no`; permlevel 1 + `no_copy` on FBR fields; tighten `create`/stored-seller checks; seller-scoped FBR context helper; `_guard_reference_access` on bulk syncs
- **Tests:** non-permitted refused; numbered Production refused; clear refused with Post Success log; cross-seller create refused; JSON permlevel/no_copy
- **Risk:** High — tax filing path; keep panel-production rule

### P0-2 Reference sync job
- **Files:** `tasks.py`, `tests/test_tasks.py` (new)
- **Approach:** `frappe.get_attr`; notify success/failure
- **Risk:** Low

### P0-3 Durable FBR outcomes + freeze filed drafts
- **Files:** `sale_tax_invoice_api.py`, `di_api.py`, `sandbox_drafts.py`, STI validate/JS/JSON (`fbr_payload_hash`), `tasks.py`, tests
- **Approach:** persist log + `db.commit` before throw; hash freeze; filed-draft alert; summarise validate errors
- **Risk:** High — commit timing / double-post

## P1 — correctness / data model

| Task | Files (main) | Tests / notes | Risk |
|---|---|---|---|
| P1-1 Scenario/Debit Note | STI json/py/js, payload, sandbox_drafts, `make_debit_note` | Debit payload, sale_type Link, scenario sandbox-only | Med |
| P1-2 UOM traps | seed_data, reference_api, STI item json, tax_item | No seed delete; fetch_if_empty; uom survives sync | Med |
| P1-3 SRO Item schedule | reference_api + patch delete orphan schedules | Report: re-sync after deploy | Low |
| P1-4 Buyer FBR verify | statl, buyer json/py/js, STI warn | Comparison + token resolution | Med |
| P1-5 ERPNext path | sales_invoice.js typo, print Jinja method | Smoke JSON/template | Low |
| P1-6 Hygiene | provinces, DI Log list, setup_status, escape_html, name validate | Unit where cheap | Low |

## P2 / H1 / S1

| Task | Deliverable |
|---|---|
| T1 | Second CI job: site-less `run.py` in `apps/di/.github/workflows/ci.yml` |
| T2 | `.gitignore`, archive `ops/_tmp_*`, key paths in README/AGENTS/ssh.sh, REVIEW.md audit section |
| H1 | `ops/push-app.sh` backup/prune/chmod/`--no-migrate`/restore hint |
| S1 | `ops/SERVER-CHECKLIST-2026-10.md` (no execute) + `ops/DI-FIX-REPORT.md` |

## Assumptions

- Safer option when ambiguous; record in report.
- Claude AI paths untouched; AI test failures out of scope.
- No deploy, SSH, push, or secrets/PDFs committed.
