# Daftar — agent notes

This folder is the live PRA consultant desk (`https://sheikhmahboob.com/pra/`). It is **not** ERPNext and **not** `pra-invoicing/`.

## Before you edit

1. Read [`README.md`](README.md).
2. If you are one of the five batch agents, read [`ops/agents/PROTOCOL.md`](ops/agents/PROTOCOL.md) and your `ops/agents/0N-*.md` file. Plan first. Implement only on `IMPLEMENT BATCH N`.
3. Leftovers **outside** those five batches: [`ops/agents/OUTSIDE-BATCHES.md`](ops/agents/OUTSIDE-BATCHES.md).

## Do not

- Scrape PRA IRIS or store IRIS passwords.
- Invent official PSIDs or file returns on the portal.
- Add undocumented GetData.
- Seed Ahmad Traders or change `shouldSeedDemoClient` (local demo only).
- Deploy with `./ops/push-app.sh di`. Use `./ops/push-pra.sh` only when Matloob asks.
- Commit unless asked.
