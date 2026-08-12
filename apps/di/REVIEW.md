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

## 2. Fixed in the follow-up pass

Sections 2.1 to 2.6 below were resolved on 2026-08-12. They are kept for the
record; the fixes are described in section 1 of the git history.

### 2.1 Client FBR tokens were stored in plain text — FIXED

`Seller Or Company.sandbox_token` and `.production_token` were `Data` fields, so
anyone with Accounts User could read every client's token and post under that
client's tax identity. Both are now `Password`, a patch moved the existing
values into encrypted storage, and the API reads them with `get_password`.

### 2.2 Purchase Invoice sent an invoice type FBR does not accept — FIXED

`invoiceType` was `"Purchase Invoice"`; DI accepts only `Sale Invoice` and
`Debit Note`. A purchase is reported from the supplier's side, so it is a sale
invoice, and a purchase return a debit note.

### 2.3 `fixedNotifiedValueOrRetailPrice` was the unit rate — FIXED

It was `net_amount / qty`. A real field now exists on Item and Sales Invoice
Item, and 0 is sent when it is not set.

### 2.4 DI Settings was loaded by name, not by company — FIXED

Resolved through the company field, so renaming a company no longer breaks
posting.

### 2.5 HS Code UOMs were unavailable — FIXED

The endpoint needs an `annexure_id`; without one FBR answers 200 with an empty
list for every code, which is why nothing was ever filled in. UOMs are now
fetched one code at a time on demand and cached, and the bulk sync is bounded.

### 2.6 A failed FBR post was never retried — FIXED

An hourly job re-posts submitted invoices with no FBR number, gives up after five
attempts and notifies the accounts team. Attempts are counted on the document,
because a failed post throws and the throw rolls back the DI Log row.

---

## 2b. Still open

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

- **Reporting** — partly addressed. A `DI Submission Status` query report now
  lists every submitted Sales Invoice and Sale Tax Invoice with its FBR number,
  retry count and posted/not-posted state. Still missing: tax summary by rate,
  monthly volumes, per-client breakdown.
- **Alerts** — addressed for the case that mattered: when the retry job gives up
  on a document, everyone with Accounts Manager or System Manager is notified.
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

1. **Setup checklist — DONE.** DI Settings has a **Check Setup** button that runs
   eleven checks and lists what is missing with the fix for each.
2. **FBR error codes translated — DONE.** Failures now carry the plain-language
   meaning from `DI Error Code`. Codes 0058, 0077 and 0078 were added; they were
   missing from the seeded list even though they are the ones you hit first.
3. **SRO schedule and item pickers — DONE.** A **Fill SRO Details** button on
   draft Sale Tax Invoices asks FBR which schedules are valid for that line's
   rate, then which serials exist under the chosen schedule.
4. **`Tax Type` unset now blocks submission — DONE.** It used to be skipped
   silently and the invoice was filed at 0%.
5. **FBR validation errors are readable — DONE.** The dialog used to show only
   `validationResponse.error`, which FBR usually leaves empty, so a rejected
   invoice said "Invalid" and nothing else. Per-item errors are shown now.
6. **Validate before submitting.** Still open. The Validate button exists but
   nothing makes you use it, and submitting posts irreversibly.
7. **Client onboarding template.** Still open. Adding a client means recreating
   seller, tokens, buyers and items from scratch.
8. **QR code and FBR number on the ERPNext Sales Invoice print format.** Still
   open; only the standalone invoice shows them.

---

## 4b. Second pass — what is left, in order of risk

### 4b.1 The retry job can file the same invoice twice — fix this first

This one was introduced by the retry work, so it goes at the top.

`post_invoice` wraps the whole HTTP call in one `except Exception`, so a flat
rejection from FBR and a read timeout are indistinguishable afterwards. A read
timeout is the dangerous case: FBR may well have recorded the invoice and only
the reply was lost. `di_integration_id` stays empty, the hourly job sees an
unposted invoice and sends it again — a second filing against a real tax
identity, which cannot be withdrawn. Before the job existed a person made that
call; now nothing does.

The payload carries no client-side reference, so FBR cannot deduplicate it
either.

Fix: separate the failure kinds. `requests.ConnectionError` means the request
never left, so retrying is safe. A definite rejection is not worth retrying at
all — the same payload will be rejected again. A read timeout or a 5xx should
stop and alert a human rather than retry. In practice that makes the job retry
almost nothing, which is the correct answer; its real value is the alert.

### 4b.2 There is effectively no test suite

Fifteen of the sixteen test files are 9-line stubs with zero test functions. The
only real tests are six in `test_tax_item.py`. For an app that files tax returns
that is thin, and it is not theoretical: all three defects found today —
`item_wise_tax_detail`, `run_method`, the SRO endpoint — would have been caught
by one test that builds a payload and asserts on it.

Worth having, in order: a payload builder test per sale type (no network,
fixtures only), a `_get_taxes` test covering both the v15 and v16 layouts, and a
retry test that proves a timeout does not cause a second post.

### 4b.3 POS fiscalisation is 385 untested lines

`pos_fiscal.py` is reachable only when a POS Profile has FBR enabled. No POS
Profile is configured here, so none of it has ever run — not the payment-mode
mapping, not the 3rd-schedule invoice types, not the NTN/CNIC splitting. It
handles money and files with FBR. Either exercise it against the sandbox or mark
it unsupported until someone does.

### 4b.4 Buyers and items are shared across all clients

`Buyer` and `Tax Item` carry no link to a `Seller Or Company`. With fifteen
clients that is one pool of buyers and one pool of items for everybody: client A
sees client B's customer list, and a User Permission on Seller Or Company cannot
help because there is nothing to restrict on. Adding an optional seller link,
and defaulting it from the invoice, would make per-client isolation possible.

### 4b.5 Every FBR call is hand-rolled

Five `requests.post`/`get` call sites, each with its own headers, its own
30-second timeout and no retry adapter, no connection pooling and no shared
error handling. One `requests.Session` with a small retry policy for connection
errors — never for reads, see 4b.1 — would remove the duplication and make
behaviour consistent.

### 4b.6 Smaller things

- The standalone `Sale Tax Invoice` and the ERPNext `Sales Invoice` path
  duplicate payload construction, error handling and QR generation. They have
  already drifted: the standalone one reads a real notified price, the ERPNext
  one had to be fixed today.
- `Scenario` and `Sandbox Scenario` hold the same twelve rows with the same
  meaning. One of them is redundant.
- No `Sales Invoice` print format shows the FBR number or QR code; only the
  standalone one does.
- `sync_reference_data` enqueues a job and reports nothing afterwards — no
  counts, no failures, no completion.

---

## 5. Suggested order

| Priority | Items |
|---|---|
| P1 — correctness and security | 2.1 tokens to Password, 3 per-client permissions, 2.2 purchase invoice type, 2.3 retail price |
| P2 — reliability | 2.6 retry queue, alerts on failure, 2.5 HS UOM on demand, 2.4 settings lookup |
| P3 — usability | 4.1 setup checklist, 4.2 error translation, 4.3 SRO dropdowns, 4.4 validate gate |
| P4 — visibility | reports, dashboard, submission tracker, bulk posting |
