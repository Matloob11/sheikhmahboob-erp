# Archived one-off production fix scripts (2026-10)

These `ops/_tmp_*` scripts were run once against live data during the October 2026
DI hardening window (panel permission repair, STI-0331/0332 UOM/validate, sandbox
probes, etc.).

**Do not re-run them.** Logic that must stay lives in the app (for example panel
Custom DocPerm repair is now `di.panel.ensure_di_panel_permissions` / migrate).

Kept only as an audit trail of what was done by hand.
