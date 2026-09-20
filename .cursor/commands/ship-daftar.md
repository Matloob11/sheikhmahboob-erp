# Ship Daftar to the live site

Only when `/verify-daftar` is fully clean.

1. From the repo root: `./ops/push-pra.sh` — wait for `PUSH_OK pra`.
2. Prove both, quote the codes:
   - `curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/pra/` → 200
   - `curl -sS -o /dev/null -w '%{http_code}\n' https://sheikhmahboob.com/login` → 200
3. Open `https://sheikhmahboob.com/pra/` with Playwright, hard reload, check the console for
   errors and look at the screen you changed.
4. Tell Matloob where to click and to press Ctrl+Shift+R (service worker).

Anything not 200 → stop and report with the output. Never run `./ops/push-app.sh di` for Daftar.
