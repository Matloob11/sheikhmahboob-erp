# Batch 7 Phase A — locked `/pra-ims` proxy

## What changed

1. Live nginx now allows only the two PostData paths (sandbox + production), GET/POST only, Origin gate on POST, rate limit, 256 KB body, Cookie stripped. Everything else under `/pra-ims` is 404.
2. CSP is nginx-only (`connect-src 'self'`, no `ims.pral.com.pk`, no `ws:`). Meta CSP removed from `index.html`; font `onload` removed so `script-src 'self'` stays valid.
3. Health check probes `/pra-ims` only (no remote PRA). Clerk-facing production IP note reworded.

## Proof (from VPS)

| Request | Code |
|---|---|
| GET /login | 200 |
| GET /pra/ | 200 |
| GET sandbox PostData | 502 |
| POST no Origin | 403 |
| POST evil Origin | 403 |
| POST good Origin | 502 |
| GET GetData | 404 |
| GET /pra-ims/ | 404 |
| DELETE PostData | 403 |

`nginx -t` ok → `RELOADED`. Live file equals `ops/nginx/srv1992968-sheikhmahboob.conf`.

`npm test` 200, `tsc -b` clean, lint warnings only.

## Files

- `ops/nginx/srv1992968-sheikhmahboob.conf`
- `pra/index.html`, `pra/src/lib/imsHealth.ts`, `pra/src/domain/invoices.ts`
- `pra/README.md`

## Left

Phase B → E per `07-finish-and-ship.md`.
