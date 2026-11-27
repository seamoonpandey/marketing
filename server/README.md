# Prachaar server

A Hono API on Postgres with row-level security, DBOS workflows, an AI gateway and S3-compatible storage. Node 24 or later, pnpm 12.11.2.

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on 5436, SeaweedFS (S3) on 8333
cp .env.example .env                             # defaults match the containers; AI_MODEL=mock
pnpm db:reset                                    # development database from the schema, plus the tenant
pnpm dev                                         # the API on http://127.0.0.1:3141
```

| Command | Does |
|---|---|
| `pnpm test` | All tests with the mock model. `*.int.test.ts` need both containers; each file gets its own database. The video test needs `ffmpeg` and skips without it |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm openapi` | Regenerates `openapi.json` (`pnpm openapi:check` fails if it is stale); then run `pnpm api:types` in `../web` |
| `pnpm db:generate` | Generates a migration from `src/db/schema/`. Never write one by hand |
| `pnpm db:migrate`, `pnpm seed` | Apply the migrations and create the tenant (production) |

Rules a contributor must follow are in `../CLAUDE.md`; the layout and shared contracts are in `../docs/structure.md`; what a deployment must set is in `../docs/status.md`.
