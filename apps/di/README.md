# TaxPearlz

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Frappe](https://img.shields.io/badge/Frappe-v16-blue.svg)](https://frappeframework.com)
[![ERPNext](https://img.shields.io/badge/ERPNext-v16-blue.svg)](https://erpnext.com)
[![Python](https://img.shields.io/badge/Python-3.10%2B-green.svg)](https://www.python.org)

Frappe / ERPNext app for **Pakistan Federal Board of Revenue (FBR) Digital Invoicing** and **POS Fiscal** services.

TaxPearlz posts, validates, and tracks tax invoices from inside ERPNext. On a successful FBR response it stores the official invoice number and can print an FBR-compliant QR code.

| | |
| --- | --- |
| Product | TaxPearlz |
| Bench app name | `di` |
| Desk title | Digital Invoicing |
| Stable branch | [`version-16`](https://github.com/Matloob11/taxpearlz/tree/version-16) |
| App version | 1.0.0 |
| License | [MIT](LICENSE) |
| Publisher | Kodlyft |

This repository is **FBR Digital Invoicing**, not Punjab Revenue Authority (PRA) IRIS, PRA eIMS, or any provincial return portal.

Product documentation: [docs.kodlyft.com/digital-invoicing](https://docs.kodlyft.com/digital-invoicing/introduction)

---

## What it does

Pakistan businesses that sell taxable **goods** must report invoices to FBR. TaxPearlz sits on ERPNext and does that reporting for you.

1. Staff create a **Sales Invoice**, **Purchase Invoice**, or **POS Invoice** as usual.
2. The app builds the FBR Digital Invoicing payload (PRAL DI API v1.12).
3. It validates and/or posts the invoice to FBR sandbox or production.
4. FBR returns an official invoice number. TaxPearlz stores it, writes a **DI Log**, and can print a QR on the tax invoice.

POS terminals can also fiscalize through FBR POS Integration Services using a POS ID and bearer token.

---

## Highlights

- Post and validate invoices against FBR Digital Invoicing
- Fiscalize POS invoices through FBR POS Integration Services
- Treat return invoices as debit notes
- Generate FBR-compliant QR codes on posted invoices
- Sync reference data from FBR: provinces, HS codes, UOMs, transaction types, SRO item codes, and schedules
- Verify buyer and seller registration status through FBR STATL
- Sales and purchase invoice flows
- Bundled sandbox scenarios before a production rollout
- Sale Tax Invoice print formats for the fiscal copy
- Desk workspace, sidebar, and actions on Sales Invoice / Purchase Invoice / Item / POS Profile

---

## Architecture

```
ERPNext document
  Sales Invoice / Purchase Invoice / POS Invoice
        │
        ▼
  TaxPearlz (app name: di)
        │  payload + token from DI Settings / POS Profile
        ▼
  FBR Digital Invoicing  or  FBR POS Fiscal
        │
        ▼
  Invoice number + DI Log + QR on print
```

Desk scripts attach to:

- Sales Invoice
- Purchase Invoice
- Item
- POS Profile

Core Python packages live under `di/`:

| Path | Role |
| --- | --- |
| `di/integrations/di_api.py` | Digital Invoicing post / validate |
| `di/integrations/sale_tax_invoice_api.py` | Sale Tax Invoice submit path |
| `di/integrations/pos_fiscal.py` | POS fiscalization |
| `di/integrations/reference_api.py` | FBR reference-data sync |
| `di/integrations/statl.py` | Buyer / seller status (STATL) |
| `di/integrations/qr_code.py` | QR generation for print |
| `di/events/` | Document hooks (`before_submit`, `before_validate`, `before_save`) |

There is no `.env` file. Tokens belong in **DI Settings** and **POS Profile** password fields. Do not commit access tokens or bearer tokens.

---

## Requirements

| Dependency | Version |
| --- | --- |
| Python | `>= 3.10` |
| Frappe | `>= 16.0.0, < 17` |
| ERPNext | `>= 16.0.0, < 17` |
| `qrcode[pil]` | `>= 8.2` |

A working Frappe bench (MariaDB, Redis, Node 18+) is required. This repository is the custom app only — it is not a full bench.

---

## Installation

Default branch is **`version-16`**.

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/Matloob11/taxpearlz --branch version-16
bench setup requirements
bench --site your-site.com install-app di
bench --site your-site.com migrate
```

Then confirm the app is on the site:

```bash
bench --site your-site.com list-apps
```

You should see `di`. Open Desk and look for the **Digital Invoicing** workspace.

Use a `develop` branch only if one exists and you intentionally want unreleased work. This repository’s published stable line is `version-16`.

### Update an existing install

```bash
cd $PATH_TO_YOUR_BENCH/apps/di
git fetch origin
git checkout version-16
git pull
cd $PATH_TO_YOUR_BENCH
bench setup requirements
bench --site your-site.com migrate
bench restart
```

---

## Configuration

Complete these steps before posting a live invoice.

### 1. DI Settings

Create one **DI Settings** record per company:

- Company
- Enable Digital Invoicing
- Environment: **Sandbox** or **Production**
- FBR access token
- NTN / CNIC
- Province
- Address

Keep production off until sandbox scenarios succeed.

### 2. Customer (buyer)

For each customer that must be reported to FBR:

- Enable Digital Invoicing
- NTN / CNIC
- Province
- Registration type
- DI address

### 3. Item

On each item used on a tax invoice:

- HS Code
- Sale Type
- Applicable SRO fields

HS codes can be synced from FBR and are also seeded from `di/data/hs_codes.json`.

### 4. Tax templates

On **Sales Taxes and Charges** templates, set **Tax Type** to one of:

- `Sales Tax`
- `Further Tax`
- `Advance Tax`

### 5. POS Fiscal (optional)

On **POS Profile**:

- Enable FBR Integration
- Environment
- FBR POS ID
- FBR bearer token

On **Mode of Payment**, set **FBR Payment Mode Code** to `1`–`6` (cash, card, gift voucher, loyalty, mixed, cheque).

### 6. Reference data

From **DI Settings**, sync:

- Provinces
- HS codes
- UOMs
- Transaction types
- SRO item codes

Do this in sandbox first so masters match FBR before you post.

---

## Usage

### Automatic posting

When **Auto Post on Submit** is enabled in DI Settings, supported invoices are sent to FBR during document submit.

### Manual actions

On a submitted Sales Invoice, the Digital Invoicing menu supports:

- **Post to FBR**
- **Validate with FBR**
- **DI Preview**
- **Verify Buyer**

### Sandbox scenarios

Use the bundled **Sandbox Scenario** / **Scenario** records to practise against FBR sandbox before switching DI Settings to production.

### Logs and reprints

Every post or validation writes a **DI Log** (request / response / status). Successful posts store the FBR invoice number on the document. Print formats **Sale Tax Invoice** / **Sales Tax Invoice** can show the number and QR.

---

## AI Assistant (drafts from plain language)

The **AI Assistant** page (`/desk/di-ai-assistant`, also in the Digital Invoicing sidebar and
as a button on the Sale Invoices list) turns a request such as *"SUBHAN ENTERPRISES ki University
of Education ko 3 water filters @ 4500 ki invoice banao"* into a **draft** Sale Tax Invoice. It
finds or creates the buyer and the Tax Item, looks the HS code, UOM and rate up (FBR reference
data with the seller's own token), derives the scenario and saves the draft. It never submits
and never posts: a person opens the draft and presses Submit.

- Users: System Managers (all sellers) and Client Panel users (their own sellers, Production
  only). The demo login sees the page but cannot chat.
- Setup: put the OpenAI key in `site_config.json` with `./ops/set-openai-key.sh <file>` (or on
  **DI AI Settings → OpenAI API Key**), tick **Enable AI Assistant**, press **Test connection**.
  Model, fallbacks, reasoning effort, turn budget and the daily per-user cap are on the same form.
- Limits: one turn per user at a time, at most `gunicorn_workers - 1` turns site-wide (override with
  `di_ai_max_concurrent_turns` in site config), 75 s per turn, a daily per-user cap, and per-turn caps
  on writes, validations and FBR lookups.
- Design, tool catalogue, limits and security notes: [`di/ai/DESIGN.md`](di/ai/DESIGN.md).
- Tests: `di/tests/test_ai_*.py` (site-less; on Windows run them through `ops/run-tests-wsl.sh`).

## Sandbox vs production

| | Sandbox | Production |
| --- | --- | --- |
| Purpose | Practice and scenario testing | Live taxpayer reporting |
| Token | FBR sandbox token | Live FBR token |
| Risk | Test data only | Real fiscal invoices |

Post to sandbox until payloads, HS codes, sale types, and buyer registration are correct. Production tokens must stay in password fields and must not appear in git, screenshots, or public issues.

---

## DocTypes

| DocType | Purpose |
| --- | --- |
| DI Settings | Company-level enablement, environment, token |
| Seller or Company | Seller / company tax profile |
| Buyer | Buyer tax profile |
| Sale Tax Invoice | Fiscal invoice document |
| Sale Tax Invoice Item | Invoice lines |
| Tax Item | Item tax / HS mapping helpers |
| HS Code | Harmonized System codes |
| HS Uom | Units of measure for HS lines |
| Sale Type | FBR sale types |
| Transaction Type | FBR transaction types |
| Province | Province master |
| SRO Item / SRO Schedule | Statutory regulatory order masters |
| Scenario / Sandbox Scenario | Sandbox practice cases |
| Company Sale Type / Company Sandbox Scenario | Per-company scenario mapping |
| DI Log | Request and response audit |
| DI Error Code | Mapped FBR error codes |

---

## Development

```bash
cd apps/di
pre-commit install
pre-commit run --all-files
bench --site your-site.com run-tests --app di
```

If the change touches Desk JavaScript or assets:

```bash
bench build
```

| Tool | Role |
| --- | --- |
| `ruff` | Python lint and format |
| `eslint` | JavaScript lint |
| `prettier` | Markdown, YAML, frontend format |
| `pre-commit` | Runs the above before commit |
| GitHub Actions | CI |
| Dependabot / pip-audit | Dependency review |
| CodeQL | Code scanning |

Python style in this repo is **tabs**, line length 110, as configured in `pyproject.toml`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch rules, PR expectations, and the full local setup.

---

## Security

This app handles tax payloads and FBR credentials.

- Store tokens only in Frappe password fields
- Restrict DI Settings, DI Log, and post actions by role
- Never commit `site_config.json`, tokens, or production payloads
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md)

---

## Project docs

| File | Contents |
| --- | --- |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute and set up a bench |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community rules |
| [SECURITY.md](SECURITY.md) | Vulnerability reporting |
| [SUPPORT.md](SUPPORT.md) | Usage and support channels |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

---

## Releases

GitHub Releases are built from tags matching `v*`. Notes are generated from tagged commits on `version-16`.

---

## What this is not

| System | Relation |
| --- | --- |
| FBR Digital Invoicing | **This app** |
| FBR POS Fiscal | **This app** (POS Profile path) |
| PRA IRIS (`e.pra.punjab.gov.pk`) | Not this app — taxpayer returns / notices |
| PRA eIMS | Not this app — Punjab services invoices |

If you need Punjab sales tax on services, that is a separate PRA product. Do not point TaxPearlz at PRA IRIS or eIMS endpoints.

---

## License

[MIT](LICENSE) © Kodlyft
