---
name: daftar-ship
description: Build, deploy and verify the Daftar PRA desk on sheikhmahboob.com. Use when asked to push, deploy, ship or "make it live" for anything under pra/, or when a brief says to ship after a phase.
---

# Ship Daftar

Daftar is static files under `/var/www/pra-site/pra` on `root@187.53.143.235`, served at
`https://sheikhmahboob.com/pra/`. The same server runs ERPNext; a Daftar deploy must never
touch it.

## Steps

1. Gate: in `pra/` run `npm test`, `npx tsc -b`, `npm run lint`. All clean or stop.
2. Deploy from the repo root: `./ops/push-pra.sh`. It sets `MSYS_NO_PATHCONV=1` and
   `PRA_LIVE_BASE=1`, builds to `pra/.live-dist`, uploads, runs `nginx -t`, reloads nginx and
   probes `/pra/`. Success line: `PUSH_OK pra`.
3. Verify: `/pra/` and `/login` both 200. The built `index.html` must reference
   `/pra/assets/...` — if it shows `Program Files/Git`, the path was mangled: do not leave that
   build live, redeploy from Git Bash with the script.
4. Look at it: Playwright → `https://sheikhmahboob.com/pra/`, hard reload, console clean.
5. Report: what changed on screen, the codes, and that a hard refresh is needed.

## Do not

- Use `./ops/push-app.sh di` (that is the ERP app).
- Edit nginx as part of a normal ship. Proxy or CSP changes are a separate, explicitly
  requested step with backup, `nginx -t`, reload, 200-check and rollback.
- Seed demo or real taxpayers into the hosted desk.

`/pra-ims` returning 502 is expected until PRA whitelists `187.53.143.235`.
