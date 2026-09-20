---
name: pra-eims-posting
description: Domain rules for posting invoices to Punjab Revenue Authority eIMS (PostData), POS registration, sandbox vs production, success codes and what must never be automated. Use when touching pra/src/lib/pra.ts, invoice status logic, the /pra-ims proxy, the go-live checklist, or when the owner asks how PRA connection works.
---

# PRA eIMS — what is true

Source: PRA "POS Component and eIMS User Manual" (linked from `e.pra.punjab.gov.pk` → eIMS).
It documents **PostData only**. There is no inquiry / GetData API. Do not invent one.

## Getting credentials (done by the taxpayer, by hand)

`reg.pra.punjab.gov.pk` → log in → Registration → **POS Client Registration**. Tabs: Business
Information, Contact Information, Branch Information, Pos Details (branch, counter name,
Primary/Secondary, MAC, **IP address** — mandatory for the live service), Generate Test POS,
Product Catalogue. POS ID and token come from there. Nothing here is done by the app or by you.

## Endpoints

- Sandbox `https://ims.pral.com.pk/ims/sandbox/api/Live/PostData`
- Production `https://ims.pral.com.pk/ims/production/api/Live/PostData`
- Header `Authorization: Bearer <token>`
- The browser always calls the same-origin proxy `/pra-ims/ims/{env}/api/Live/PostData`.
  Production accepts only whitelisted IPs; the proxy makes PRA see `187.53.143.235`. A direct
  browser call fails CORS and would leave from the laptop's IP — never add one back.

## Outcomes

| What came back | Status | Next |
|---|---|---|
| Code `100` or `00` | `posted` | store fiscal number, environment, POS ID; freeze the invoice |
| Sandbox Code `100` + `InvoiceNumber: "Not Available"` | `posted` (sandbox) | fine in sandbox only |
| Explicit PRA rejection with a code | `failed` | user fixes data, may retry |
| Timeout, abort, 5xx, HTML, network drop | `unknown` | user checks IRIS → IMS Fiscal Report; enters the fiscal number or marks "not posted"; only then retry. USIN stays frozen |
| "USIN already exists" | treat as already posted | never change the USIN to get around it |

Never auto-post to production, never retry an `unknown` automatically.

## Tax rules encoded in the app

Tax on `saleValue − discount`; header Discount = sum of line discounts; credit notes (type 3)
negative; only production posts count in returns; payment due the 15th, return due the 18th of
the next month; a `filed` period is locked.

## Testing

Fake `fetch` in Vitest. Sandbox only with a POS ID and token the owner supplied. Production: never.
