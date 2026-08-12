# Digital Invoicing — review and roadmap

State as reviewed on 2026-08-12, against frappe 16.31 / erpnext 16.31 on
instance B. All ten FBR sandbox scenarios (SN001, SN002, SN005, SN006, SN007,
SN016, SN017, SN018, SN019, SN024) now post successfully and carry FBR invoice
numbers.

---

## 1. Fixed during this review

| What | Why it mattered |
|---|---|
| `_get_taxes` read `item_wise_tax_detail` | ERPNext 16 moved item-wise tax to an `item_wise_tax_details` child table. Every invoice went to FBR with `rate: "0%"` and tax `0.00` while the invoice on screen showed 18%. Silent wrong tax filing. |
| `build_sale_tax_invoice_payload` used `run_method("_sync_...")` | Frappe 16 refuses `run_method` on underscore names. Every post and validate on Sale Tax Invoice raised before reaching FBR, so the doctype could not be submitted at all. |
| `sync_sro_item_codes` hit `v1/sroitemcode` | That path answers 200 with the UOM list, so the sync stored UOM names as SRO serials. Correct endpoint is `v2/SROItem`, needs `sro_id`, and needs an ISO date — the `dd-Mon-yyyy` form used elsewhere returns 500. Without real serials, every non-18% line fails FBR errors 0077/0078. |
| `hs_codes.json` seeded junk | Only 6 of its 7,767 rows carry a well-formed `NNNN.NNNN` code; the rest are fragments like `.2` and `2.292`. 3,861 junk HS Codes were purged and the seed now rejects malformed codes. |
| HS seed ran on every migrate | A full 11.6k-row pass on each deploy. Now guarded by a digest of the bundled file. |
| `DI Log` had no retention | Stores full request and response bodies, unbounded. Now cleared at 90 days. |
| `get_fbr_logo_data_uri` | Looked for a filename that has never shipped, so it always returned `""`. |
| Same JS loaded three times on the Tax Item list | `doctype_list_js` duplicated scripts Frappe already auto-loads. |
| Sale Tax Invoice list showed no seller | With more than one client you could not tell whose invoice a row was. |

---

## 2. Still broken or risky

### 2.1 Client FBR tokens are stored in plain text — highest priority

`Seller Or Company.sandbox_token` and `.production_token` are `Data` fields, not
`Password`. Anyone with the Accounts User role can open the record, or export the
list, and read every client's FBR token. `DI Settings` already does this
correctly with `Password` fields.

With one company this is untidy. With fifteen clients it means one user can post
invoices under any client's tax identity. Change both fields to `Password` and
re-enter the tokens.

### 2.2 Purchase Invoice sends an invoice type FBR does not accept

`di_api.build_di_payload` sets `invoiceType = "Purchase Invoice"` for purchase
documents. The DI specification only accepts `Sale Invoice` and `Debit Note`, so
purchase posting almost certainly fails every time. Untested here because no
purchase invoices exist.

### 2.3 `fixedNotifiedValueOrRetailPrice` is the unit rate, not the retail price

`di_api` computes it as `net_amount / qty`. For 3rd Schedule goods FBR expects
the notified retail price and validates tax against it, so those lines will fail
(errors 0090, 0102). The standalone Sale Tax Invoice does this correctly by
reading `Tax Item.fixed_rs`.

### 2.4 DI Settings is loaded by name, not by company

`db.exists("DI Settings", {"company": X})` is followed by
`get_doc("DI Settings", X)`. That only works while the record name equals the
company name. Renaming a company breaks posting.

### 2.5 HS Code UOMs are effectively unavailable

1 of 7,803 HS Codes has a UOM. `sync_hs_code_uoms` cannot fill them because it
requires `annexure_id` on DI Settings (empty) and issues one API call per HS
code — 7,803 sequential requests. When the UOM is missing the payload falls back
to the ERPNext UOM (`Nos`), which FBR rejects with error 0099.

Practical fix: fetch UOMs only for the HS codes actually used, on demand, and
cache them.

### 2.6 A failed FBR post is never retried

`scheduler_events` is empty. If FBR is down or the token expires mid-day, each
invoice must be re-sent by hand from the form. There is no queue, no backoff and
no record of what still needs sending.

### 2.7 STATL disagrees with the FBR certificate

`verify_buyer` on registration `3630264674703` returns
`REGISTRATION_TYPE: unregistered` even though the FBR verification printout says
"Registered for Sales Tax: Yes, Sales Tax: OPERATIVE". Most likely the sandbox
token cannot read live ATL data. Confirm before relying on this in production —
a wrong registration type on an invoice triggers error 0106.

### 2.8 Scenario master does not match the FBR account

The seeded master carries SN008, SN026, SN027 and SN028, which are not assigned
to this account, and was missing SN018 and SN019, which are. They were added by
hand. Scenarios are per taxpayer, so the seed cannot be right for everyone —
they should be pulled from the account, or at least reconciled with a warning.

---

## 3. Missing entirely

Verified: 0 Reports, 0 Dashboards, 0 Dashboard Charts, 0 Notifications, 0
Workflows in this module.

- **No reporting.** Nothing answers "how many invoices went to FBR this month",
  "which ones failed", "sales tax payable by rate", "which clients are behind".
  Everything has to be read out of DI Log by hand.
- **No alerts.** When a post fails nobody is told. The error lives in DI Log and
  is found only when someone looks.
- **No approval step.** An FBR submission cannot be reversed, yet any Accounts
  User can submit straight to production with no second pair of eyes.
- **No bulk posting.** Fifty invoices means fifty form visits.
- **No per-client isolation.** Every Accounts User sees every client's invoices,
  buyers and tokens. There is no User Permission scheme tied to Seller Or
  Company.
- **No submission tracker.** Which sandbox scenarios are done had to be read off
  the FBR portal; the app knows nothing about the required set.
- **No reference-sync feedback.** `sync_reference_data` enqueues a job and says
  "you will be notified", but nothing reports success, failure or counts.

---

## 4. What a beginner trips over

Setting this up currently requires knowing, in order: create DI Settings, paste
the right token for the right environment, fill the sale types child table,
create HS codes with UOMs, set `Tax Type` on the tax template, give the buyer an
NTN that is not your own, and pick a scenario that matches the sale type. Nothing
in the interface says any of this, and most mistakes fail late and quietly.

1. **A setup checklist page.** One screen listing each prerequisite with a tick
   or a cross and a link to fix it. This alone removes most support questions.
2. **Translate FBR error codes.** The `DI Error Code` doctype already holds 46
   codes with explanations, but nothing links a failure to it. Show
   "0077 — a valid SRO/Schedule number is required when the rate is not 18%"
   next to the failure, with the fix.
3. **SRO schedule and item as dropdowns.** Today the user must know the strings
   `EIGHTH SCHEDULE Table 1` and serial `70`. FBR returns valid options per rate;
   these should be filtered link fields, not free text.
4. **Validate before submitting.** The Validate button exists but nothing makes
   you use it, and submitting posts irreversibly. Validate on save, or block
   submission until a validation has passed.
5. **Warn when `Tax Type` is unset.** A tax row without `di_tax_type` is skipped
   silently — the same class of bug that sent 0% to FBR for months. It should
   refuse to submit, or at least warn.
6. **Client onboarding template.** Adding a client means recreating seller,
   tokens, buyers and items from scratch. A duplicate-from-existing action would
   help.
7. **Show the QR code and FBR number on the ERPNext Sales Invoice print format**,
   not only on the standalone one.

---

## 5. Suggested order

| Priority | Items |
|---|---|
| P1 — correctness and security | 2.1 tokens to Password, 3 per-client permissions, 2.2 purchase invoice type, 2.3 retail price |
| P2 — reliability | 2.6 retry queue, alerts on failure, 2.5 HS UOM on demand, 2.4 settings lookup |
| P3 — usability | 4.1 setup checklist, 4.2 error translation, 4.3 SRO dropdowns, 4.4 validate gate |
| P4 — visibility | reports, dashboard, submission tracker, bulk posting |
