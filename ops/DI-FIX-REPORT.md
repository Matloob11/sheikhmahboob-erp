# DI fix report (`di-fixes`)

Branch tip at finish: `269f7fe`. Nothing pushed. No deploy / SSH / bench against the VPS.
Claude AI paths (`apps/di/di/ai/**`, `di_ai_*` doctypes/page, `test_ai_*.py`) were not modified or committed.

## Suite (final)

```
Ran 261 tests in 0.532s
FAILED (failures=2, errors=1, skipped=4)
```

All three failures are in Claude’s `di.tests.test_ai_tools` (Sale Type lookup in AI `_prepare_items`). Out of scope per the brief. Every non-`test_ai_*` test passed, including UOM / STATL / API guards / FBR outcome.

Step 0c baseline (pre-AI tests in the tree): `Ran 193 … OK (skipped=4)`.

## Commits (ordered)

| Commit | Task |
|---|---|
| `1ada4a7` | Baseline: demo viewer, panel perms, FBR timeouts, panel-production |
| `7412c49` | Step 0c: green site-less suite |
| `c812c47` | P0-1: whitelist guards, freeze filed fields, seller scope |
| `de9cd8c` | P0-2: `frappe.get_attr` for reference sync job |
| `85e4428` | P0-3: durable FBR outcomes + filed-draft freeze |
| `07baa41` | T1: site-less CI job |
| `5f02bbd` | H1: harden `push-app.sh` |
| `a50afdd` | P0-1 follow-up: persist FBR number via `db_set` on resync |
| `b8b48c1` | T2: gitignore / archive `_tmp_*` / SSH key docs / REVIEW |
| `e391e87` | P1-1: Debit Note / scenario / sale_type |
| `50ec21c` | P1-2: UOM seed + `fetch_if_empty` |
| `9db1feb` | P1-3: SRO schedule on SRO Item |
| `474f7c8` | P1-4: Buyer STATL verify |
| `f977d69` | P1-5: Verify Buyer typo + Frappe 16 tax print |
| `e40db18` | P1-5 follow-up: Sales Tax bucket shape in print |
| `328ddb6` | P1-6: province junk, DI Log columns, setup checks, HTML escape |
| `269f7fe` | P1-6 follow-up: `Un-Registered` normalise; Tax Item `getattr` |

Plan: `ops/DI-FIX-PLAN.md` (committed with P0-1). Server checklist: `ops/SERVER-CHECKLIST-2026-10.md` (this S1 commit).

## Per task

### Step 0
Branch `di-fixes` from in-progress tree; baseline + suite green before fixes.

### P0-1
Doc-level `has_permission` on mutating whitelists; refuse second Production post; SM-only `clear_fbr_invoice_no`; `permlevel 1` + `no_copy` on FBR fields; tighten panel create/stored-seller; `seller_credentials` / `seller_fbr_context`; `_guard_reference_access` on bulk syncs. Follow-up: API paths pass `resync=True` so the FBR number is `db_set`, not memory-only.

### P0-2
`tasks.run_reference_sync` uses `frappe.get_attr`; notifies success/failure.

### P0-3
`fbr_outcome` persists DI Log + `db.commit` before throw; `fbr_payload_hash` freeze; filed-draft alerts; validation errors summarised on logs.

### P1-1
Sandbox-only `scenarioId`; Debit Note path; editable sale types on STI items.

### P1-2
`seed_hs_uoms` no longer deletes/nulls UOMs; invoice item `uom`/`hs_code` use `fetch_if_empty`; sync only fills blanks; Tax Item refuses unknown new UOMs.

**Manual check after deploy:** edit a line UOM, save, reload — value must stick.

### P1-3
`sync_sro_item_codes` stores `sro_schedule`; patch clears blank-schedule rows. **After deploy:** run “Sync SRO Item Codes” once.

### P1-4
Internal `_fetch_registration_type`; Buyer `verify_buyer_with_fbr` (seller production token); form button; non-blocking STI warning on mismatch.

### P1-5
`custome` → `customer` on Sales Invoice Verify Buyer; Jinja helper for Frappe 16 tax columns (follow-up for Sales Tax bucket shape).

### P1-6
Skip/delete Province `all`; DI Log list columns; setup_status seller/token checks; `escape_html` / `|e` on prints; reject `<>` in naming fields. Follow-up: STATL treats `Un-Registered` as Unregistered.

### T1 / T2 / H1
Site-less CI job; ignore PDFs/secrets + archive `ops/_tmp_*` + Hp SSH key docs; `push-app.sh` site backup, `di-backups` prune, chmod, `--no-migrate`, restore hint on migrate failure. **H1 not executed.**

### S1
Checklist only — Matloob runs on the VPS. See `ops/SERVER-CHECKLIST-2026-10.md`.

## Assumptions

- Safer option when ambiguous (e.g. keep panel-production rule; AI failures ignored).
- `fbr_payload_hash` may be missing from `field_order` (hidden; cosmetic).
- Existing DB backups still hold plaintext tokens in `tabVersion` until purge/off-box rotation.

## Deferred

- Claude AI assistant + its failing tests.
- Live deploy, migrate, Sync UOMs / Sync SRO Item Codes, SSH hardening, reboot, 2FA — checklist only.
- FBR payload shape unchanged except Debit Note fields (P1-1).
