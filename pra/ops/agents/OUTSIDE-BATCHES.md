# Leftovers outside the five batches

Updated 18 Sep 2026 after the leftover pass.

## Shipped in the leftover pass

- Ledger `psidPaid` uses `paidAmount` / `paidAmountFor`
- `clientReadiness` respects CNIC-as-registration
- Backup filename is Karachi civil date; import preview lists places/banks/POS; export open client
- Call / WhatsApp on Clients + Buyers forms
- Invoice clone draft, email / WhatsApp summary, 80mm print, line `aria-label`s, editor skeleton
- Buyer remove undo (30 min session)
- Client merge + single-file export
- Fiscal year + dark/system theme
- `/pra-ims` health check (GET only)
- Keyboard `?` sheet
- First-run hosted cabinet warning
- Dexie schema upgrade banner
- Online retry for network-looking failed posts
- `CHANGELOG.md`, `LICENSE`, `public/404.html`

## Still not software (Matloob / PRA)

1. Whitelist email + PRA approval for `187.52.120.196`
2. VPS TLS to `ims.pral.com.pk` (`/pra-ims` 502) — nginx SNI/bind/TLS knobs applied; PRA still FINs the handshake. Needs whitelist / PRA network.
3. Real POS token on the live file
4. First production invoice + IRIS Fiscal Report check
5. Import a backup in the Chrome that should hold the cabinet

## Intentionally out

IRIS scrape, 1Bill create, official return submit, undocumented GetData, NADRA, hosted Ahmad Traders seed, staff/sync server, encrypting the whole IndexedDB, inventing a PRA QR spec, full Urdu UI, official Annex B/D / `.xlsm`.
