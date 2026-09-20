# Batch 7 Phase D — UI batch 2

## What changed

1. **Friendly list labels** — invoice/return/environment status text and list dates use shared helpers (`statusLabel.ts`, `formatListDateTime`).
2. **Clients work queue** — list reuses `buildWorkQueue` (stage, unclear/failed/to send/PSID/return), sorted, 50 per page; archived optional via `includeArchived`.
3. **Client switcher** — recent clients in `localStorage`, search cap 20, combobox keyboard (arrows/Enter/Escape).
4. **Field errors + line grid** — `Field`/`TextInput`/`AmountInput` support `error` + `aria-invalid`/`aria-describedby`; validate focuses first bad control; Enter adds a line; arrows move between rows.
5. **Splits** — `Clients.tsx` / `InvoiceEditor.tsx` thinned; tabs/steps under `pages/clients/` and `pages/invoice/`.
6. **One stylesheet** — `smc-theme.css` merged into `index.css`; dark theme block removed; hard-coded `#fff` → `var(--surface)` outside `:root`; single import in `main.tsx`.

QR / Urdu still deferred.

## Proof

From `pra/`: `npm test` → **208 passed**; `npx tsc -b` clean; `npm run lint` warnings only.

## Left

Phase E — backend plan only (finalize `batch-6-backend-plan.md`), then stop.
