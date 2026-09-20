# Daftar — PRA consultant desk

Local-first software for Punjab Revenue Authority work. It does **not** clone [PRA IRIS](https://e.pra.punjab.gov.pk/public/txplogin.xhtml). Client files stay in this browser. Official login, notices, and 1Bill PSID creation still happen on IRIS.

Live URL: https://sheikhmahboob.com/pra/

## What it covers

1. **eIMS / POS** — build invoices, validate locally, post to PRA `PostData` (sandbox or production). `/pos` is a one-line cash sale on the same `submitInvoice` path.
2. **Return helper** — Annex C from posted sales, Annex A purchases (including blocked / non-adjustable input tax), Excel workbook for the period.
3. **Consultant cabinet** — many client files, buyers/items, POS credentials, PSID/CPR register, JSON backup.

## Run locally

```bash
cd pra
npm install
npm run dev
```

Open http://localhost:5173

Local first launch creates a **Demo Traders (Sandbox)** file. The hosted production build does **not** — it starts as an empty desk. Replace POS ID and token with values from PRA IRIS → eIMS / POS registration before live use.

Vite proxies `/pra-ims` to `ims.pral.com.pk` so the browser can post without CORS issues during local development.

## Deploy `/pra`

Static files only. Do **not** use `./ops/push-app.sh di`. Do **not** run bench migrate/restart.

```bash
./ops/push-pra.sh
```

That script:

1. Builds with `PRA_LIVE_BASE=1` into an isolated folder (public path `/pra/`). Do not pass `--base=/pra/` through Git Bash — it rewrites that to `Program Files/Git/pra`.
2. Uploads only if `index.html` contains `src="/pra/assets/`
3. Runs `nginx -t` and reloads nginx only. No bench migrate/restart.

SSH key (this machine): `C:\Users\Matloob\.ssh\hostinger_srv1992968` → `root@187.53.143.235`.

The script sets `MSYS_NO_PATHCONV=1` so Git Bash does not rewrite `--base=/pra/` into `C:/Program Files/Git/pra/`. Do not deploy a build whose `index.html` script src is not `/pra/assets/...`.

Nginx already serves:

- `/pra` → static SPA (`try_files` → `index.html`)
- `/pra-ims/…/PostData` → locked reverse proxy to the two documented PRA PostData URLs only

Repo copy of the live vhost: `ops/nginx/srv1992968-sheikhmahboob.conf`.

## Official PRA endpoints

From the [POS Component user manual](https://e.pra.punjab.gov.pk/templates/POS_COMPONENT_and_eIMS_User_Manual.pdf):

- Sandbox: `https://ims.pral.com.pk/ims/sandbox/api/Live/PostData`
- Production: `https://ims.pral.com.pk/ims/production/api/Live/PostData`
- Header: `Authorization: Bearer <token>`

Hosted Daftar posts **only** to same-origin `/pra-ims/ims/{sandbox|production}/api/Live/PostData`. There is no browser fallback to `ims.pral.com.pk` (that would leave from the laptop IP and bypass the whitelist). Timeout / 502 / HTML → outcome **unknown**; reconcile from IRIS → IMS Fiscal Report. Other `/pra-ims` paths return 404. `POST` without `Origin: https://sheikhmahboob.com` returns 403. Rate limit 120/min per IP; body cap 256 KB.

A post is success only when PRA returns Code `100` or `00`. Sandbox demo POS IDs often return Code `100` and `InvoiceNumber: "Not Available"` — accepted in sandbox. A lone fiscal number that is not `"Not Available"` is **not** enough if the body is an error. `"Not Available"` by itself is not success.

The manual documents **PostData only**. It does **not** document an inquiry or `GetData` API, so Daftar does not invent “refresh fiscal from PRA”. After a post, look up the fiscal number on PRA IRIS → IMS Fiscal Report.

## Production IP whitelist

Production `PostData` only accepts whitelisted IPs. The proxy IP is this VPS: **187.53.143.235**. Do not send a laptop IP. The whitelist is **not** approved yet.

Email **eims@pra.punjab.gov.pk**:

```
Subject: eIMS / POS IP whitelist — [Business name] — PNTN [1234567-8]

Dear eIMS team,

Please whitelist the following production IP for PRA eIMS PostData.

PNTN: [1234567-8]
Business name: [legal name]
POS ID: [from IRIS → eIMS / POS registration]
Server IP: 187.53.143.235
Location: [city / branch]

We post from this server to https://ims.pral.com.pk/ims/production/api/Live/PostData.

Regards,
[Name]
[Phone]
```

## What Daftar will not do

- Log into IRIS inbox or scrape `inboxWorkFlowView.xhtml`
- Invent official PSIDs (those come from Create Payment on IRIS)
- Create official 1Bill PSIDs or mark tax paid at the bank
- Replace the official Sales Invoice `.xlsm` macros on the portal
- File the sales tax return on IRIS (the Excel pack is working paper)
- Call an undocumented GetData / fiscal-inquiry API

## Backup

Settings → Export desk backup. Choose **encrypt tokens with a password** or **strip tokens**. Treat the file as confidential. Import previews counts and asks before replace; merge-by-id is available. The desk never uploads the file to a server.

A banner reminds this browser to download again after 7 days (or if it has never exported and a client file exists). Snooze is local only.

### Hosted empty desk + import

`https://sheikhmahboob.com/pra/` is a production build. `shouldSeedDemoClient` is false there, so the first visit is an **empty** practice — no Demo Traders.

To move a local file onto the hosted desk:

1. On the machine that already has data, Settings → Export (encrypt tokens or strip).
2. On the hosted desk, Settings → Import backup. Preview the counts, then **Replace desk** or **Merge by id**.
3. Encrypted vaults need the backup password (not the practice PIN unless you chose the same string).
4. After restore, if the backup includes a practice PIN, the desk locks until that PIN is entered.
5. v5 backups also carry places, banks, and POS devices. Older v4 files still import (those tables stay empty).

Do not seed Ahmad Traders or any real taxpayer into the hosted app.

## Leftovers for Matloob

These are **not** done. Do not treat them as shipped.

1. **Whitelist approval** — send the email above. Until PRA replies, production PostData can fail even with a real token.
2. **VPS → `ims.pral.com.pk` TLS** — the locked `/pra-ims` PostData proxy is nginx (not Frappe). SNI, IPv4 bind, TLS 1.2/1.3, and session-reuse-off are on `sheikhmahboob.conf`. That is not enough: TCP to PRA can succeed, then PRA closes the handshake — `SSL_ERROR_SYSCALL` / 502. After PRA allowlists `187.53.143.235`, confirm sandbox PostData through `/pra-ims` returns PRA JSON, not 502. The desk does **not** fall back to a remote PRA URL.
3. **Real POS token** — put the client’s IRIS eIMS token and POS ID on the client file. Demo POS `100000` + the published sandbox token is not a live client.
4. **First live invoice** — after 1–3, post one real invoice on production and confirm the fiscal number on IRIS → IMS Fiscal Report.
5. **PWA** — the hosted desk can be installed (manifest + service worker). The worker does not cache `/pra-ims` and is not an offline post queue.
6. **Track B** — no staff login, no cloud sync server, no GetData. nginx `/pra-ims` is locked to PostData only (Sep 2026); the 502 remains a PRA-side close until whitelist.
