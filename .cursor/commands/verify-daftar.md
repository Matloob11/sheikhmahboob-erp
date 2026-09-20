# Verify Daftar

Run from `pra/` and report the real numbers, not a summary:

1. `npm test` — test files and tests passed/failed.
2. `npx tsc -b` — must print nothing.
3. `npm run lint` — new warnings only count if they are in files you touched.

If anything fails, show the failing test name and the assertion, find the root cause before
changing code, and do not call the task done.
