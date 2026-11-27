# Sprint 1 base: implementation plan

> This is the plan the module was built from, kept for reference. `docs/structure.md` and the code are the current truth.

> **For the agent executing this plan:** one agent runs the whole plan on branch `product/base`, task by task. Each task: write the listed tests, watch them fail, implement, run the check, commit. Track the tasks with the checkboxes.

**Goal:** the shared foundation that the Brand and Research branches build on: the `server/` project, tenancy, the engine parts and the product's web shell.

**Architecture:** a Hono API over Postgres with row-level security, DBOS for background runs, the AI SDK behind one `extract` function that prices and records every call, and S3-compatible storage. The web shell is a second root layout in the existing Next.js app that calls `/api` through a generated client.

**Tech stack:** TypeScript, Hono, `@hono/zod-openapi`, Zod, Drizzle, Postgres 18, DBOS Transact, AI SDK, Vitest; Next.js 16, TanStack Query, openapi-fetch, Playwright.

**Spec:** `docs/structure.md` (the contracts you implement, section 4) and `docs/superpowers/specs/2026-11-27-brand-onboarding-design.md` sections 3, 8 (steps 1 to 3), 10 and 11. In the requirements spec read only these line ranges: 24–36 (developer rules), 1732–1767 (§16 data), 1982–2018 (§21 audit fields).

## Global constraints

- Implement every signature in `docs/structure.md` section 4 exactly as written. The two module branches are written against them.
- Dependency versions: the ones pinned in `docs/stack.md` section 1, table rows only. Do not read the rest of that file.
- Money is `numeric` and travels as decimal strings. Timestamps are `timestamptz` in UTC. IDs are `uuid` defaulting to `uuidv7()`.
- The app connects as `marketing_app`, which has no `BYPASSRLS` and no `UPDATE` or `DELETE` on `audit_events`.
- Tests use `AI_MODEL=mock`. Make no paid model call.
- Ports: web 3140, API 3141. Port 3040 belongs to the owner's running server; never stop it.
- Start containers with `colima start` and `docker compose -f server/docker-compose.dev.yml up -d`. Do not remove other containers or volumes.
- `web/`: read `web/AGENTS.md` first and the Next.js guides it points to before writing a layout or config. Do not change anything under `src/app/(marketing)/`, `public/landing.css` or `public/theme.css`.
- Commits carry no AI attribution line.

## Review focus

Inputs the spec implies and no acceptance test names. Each has a test in its owning task.

1. A page URL that serves a PDF, an image or an endless stream: `fetchPage` rejects it by content type and size (task 5).
2. A site with no sitemap and navigation built by JavaScript: `pickPages` returns the homepage alone, not an error (task 5).
3. An upload named in Devanagari, with spaces, or 300 characters long: the object key uses the ID only and the name is kept in `meta` (task 6).
4. A pooled connection reused after `withBrand`: it carries no brand context (task 2).
5. A brand whose name has no Latin letters: it still gets a unique slug (task 9).

---

### Task 1: Server scaffold, dev services, test harness

**Files:** `server/package.json`, `tsconfig.json`, `vitest.config.ts`, `drizzle.config.ts`, `.env.example`, `docker-compose.dev.yml`, `src/config.ts`, `src/app.ts`, `src/main.ts`, `src/http/errors.ts`, `test/helpers.ts`, `src/app.test.ts`

**Produces:**
- Scripts: `dev`, `build`, `start`, `test`, `typecheck`, `openapi`, `openapi:check`, `db:generate`, `db:migrate`, `seed`.
- `createApp()` in `src/app.ts`.
- `test/helpers.ts`: `testDb(): Promise<{ tenantId: string; makeBrand(name?: string): Promise<string>; close(): Promise<void> }>`. It creates database `mkt_test_<random>`, applies the current schema and seeds one tenant. `close()` drops the database.
- Error body for every non-2xx: `{ error: { code: string; message: string } }`. `src/http/errors.ts` exports `NotFoundError` (404), `ConflictError` (409), `ValidationError` (400) and `BudgetError` (402), and `createApp()` maps them.
- Env names: `DATABASE_URL`, `DATABASE_ADMIN_URL`, `DBOS_SYSTEM_DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AI_MODEL` (default `anthropic:claude-opus-5-5`), `ANTHROPIC_API_KEY`, `AI_MONTHLY_CAP_NPR` (default `5000`), `USD_NPR` (default `155.08`), `TENANT_SLUG` (default `xenextech`), `PORT` (default `3141`).

- [ ] Test `GET /api/health` returns 200 `{ "status": "ok" }`.
- [ ] Test `testDb()` creates a database that exists, and `close()` removes it.
- [ ] Check: `pnpm test && pnpm typecheck`.

### Task 2: Core schema and tenancy

**Files:** `src/db/client.ts`, `src/db/tenant.ts`, `src/db/seed.ts`, `src/db/schema/core.ts`, `src/db/schema/index.ts`, `src/db/tenant.int.test.ts`

**Produces:** `withTenant`, `withBrand`, `brandColumns`, `brandPolicies`, `runColumns`, and the tables:

| Table | Columns beyond `id`, `tenant_id`, `created_at` |
|---|---|
| `tenants` | `name`, `slug` unique, `timezone`, `currency`, `status` |
| `brands` | `name`, `slug` (unique per tenant), `website`, `country`, `timezone`, `currency`, `default_language`, `languages text[]`, `status` (`active`, `archived`) |
| `competitors` | `brand_id`, `name`, `kind`, `site`, `handles jsonb`, `ad_library_url`, `priority` |
| `sources` | `brand_id`, `kind`, `uri`, `mime`, `checksum`, `captured_at`, `object_key`, `text`, `trust`, `meta jsonb` |
| `cost_events` | `brand_id`, `run_type`, `run_id`, `provider`, `model`, `input_tokens`, `output_tokens`, `ok`, `rate_in_usd`, `rate_out_usd`, `usd_npr`, `cost_usd numeric(12,6)`, `cost_npr numeric(12,2)` |
| `audit_events` | `brand_id` nullable, `actor`, `action`, `object_type`, `object_id`, `object_version`, `result`, `reason`, `trace_id`, `prev_hash`, `hash` |

- [ ] Test: inside `withBrand(A)`, selecting `sources` returns A's rows only, and inserting a row with brand B's ID fails (AT-001).
- [ ] Test: `withBrand` with a brand of another tenant throws `NotFoundError` and leaves one `denied` audit event.
- [ ] Test: as `marketing_app`, `UPDATE audit_events` and `DELETE FROM audit_events` both fail with a permission error.
- [ ] Test (review focus 4): after a `withBrand(A)` call ends, a new query on the same pool reads `current_setting('app.brand_ids', true)` as empty.
- [ ] Check: `pnpm test`.

### Task 3: Audit and costs

**Files:** `src/domain/audit/index.ts`, `src/domain/costs/index.ts`, `src/ai/registry.ts`, their tests

**Produces:** `audit`, `estimateCost`, `remainingMonthlyCap`, and an internal `recordCost` used by task 7. The registry holds one model: `anthropic:claude-opus-5-5` at USD 4 per million input tokens and USD 20 per million output tokens.

- [ ] Test: `estimateCost('anthropic:claude-opus-5-5', 1_000_000, 100_000)` returns `{ usd: '6.0000', npr: '930.48' }`.
- [ ] Test: with the cap at NPR 5000 and one recorded cost of NPR 930.48 this month, `remainingMonthlyCap` returns `npr: '4069.52'`. A cost recorded last month does not count.
- [ ] Test: each `audit` row's `hash` covers its fields and the previous row's hash, so changing an old row breaks the chain.
- [ ] Check: `pnpm test`.

### Task 4: Storage

**Files:** `src/storage/index.ts`, `src/storage/index.int.test.ts`

- [ ] Test: `objectKey(t, b, 'upload', id, 'pdf')` is `tenant/<t>/brand/<b>/upload/<id>.pdf`.
- [ ] Test: `putObject` then `getObject` returns the same bytes.
- [ ] Test: a `presignDownload` URL for a `.pdf` or `.svg` key responds with `Content-Disposition: attachment`; a `.png` key does not.
- [ ] Check: `pnpm test`.

### Task 5: Guarded fetcher and page picker

**Files:** `src/domain/sources/fetch.ts`, `pick-pages.ts`, `html-text.ts`, their tests, `test/fixtures/base/site/*.html`

**Limits:** `http` and `https` only; 5 redirects; 2 MB body; 10 second timeout; content type `text/html` or `application/xhtml+xml`; User-Agent `PrachaarBot/0.1`; one request per second per host. Check the resolved IP at connect time and again after every redirect.

- [ ] Test: `fetchPage` rejects each of `http://127.0.0.1/`, `http://10.0.0.5/`, `http://169.254.169.254/`, `http://[::1]/`, `file:///etc/passwd`, a hostname that resolves to a private address, and a public URL that redirects to a private one.
- [ ] Test: a sixth redirect fails; a 3 MB body fails; a URL serving `application/pdf` fails (review focus 1).
- [ ] Test: a path disallowed by `robots.txt` for `PrachaarBot` or `*` is refused.
- [ ] Test: `pickPages(site, 10)` returns same-site URLs only, at most 10, homepage first, preferring paths that contain about, product, service, pricing, contact, faq, terms or refund.
- [ ] Test (review focus 2): a homepage with no sitemap and no links yields `[homepage]`.
- [ ] Test: `html-text` drops `script`, `style` and `nav` and keeps Devanagari text intact.
- [ ] Check: `pnpm test`.

### Task 6: Sources, uploads, quote check

**Files:** `src/domain/sources/index.ts`, `uploads.ts`, `extract-text.ts`, `verify-quote.ts`, their tests

**Limits:** allowed types PDF, DOCX, PNG, JPEG, WebP, SVG, TXT, MD and CSV, decided by magic bytes; 25 MB per file; PDF page count stored in `meta.pages`, refused above 600. `verifyQuote` normalises both strings with NFKC, lower case, collapsed whitespace and ASCII quote marks and dashes, requires the quote to be 10 to 300 characters after that, and tests containment.

- [ ] Test: `savePageSource` stores the HTML snapshot under a `snapshot` key and the text, checksum and `captured_at` on the row.
- [ ] Test: `completeUpload` rejects a `.pdf` whose bytes are a PNG, and an executable.
- [ ] Test (review focus 3): a file named `ब्रान्ड गाइड final (2).pdf` is stored at a key made of IDs only, with the name in `meta.filename`.
- [ ] Test: text is extracted from a fixture PDF with a text layer and from a fixture DOCX; a PDF with no text layer gives `text: null`.
- [ ] Test: `verifyQuote` is true across differing whitespace, curly quotes and composed versus decomposed Devanagari; false for a quote that is absent; false for a 9-character quote.
- [ ] Check: `pnpm test`.

### Task 7: AI gateway

**Files:** `src/ai/index.ts`, `estimate.ts`, `mock.ts`, `src/ai/index.int.test.ts`

**Rules:** `estimateTokens` counts 1 token per 4 characters of text, 2,500 per PDF page (from the file's page count) and 1,600 per image. `extract` sends no tools.

- [ ] Test: `extract` with one queued mock object returns it parsed and writes one `cost_events` row with `ok = true` and the rate snapshot.
- [ ] Test: a first answer that fails the schema triggers exactly one repair call; a second failure throws `AiError` with `retryable: false`, and two cost rows exist.
- [ ] Test: when the estimate exceeds `remainingMonthlyCap`, `extract` throws `BudgetError` and `mockAi.calls` is empty.
- [ ] Test: a refusal finish reason throws `AiError` with `retryable: false`.
- [ ] Test: no tool definitions are passed to the model call.
- [ ] Check: `pnpm test`.

### Task 8: Workflows

**Files:** `src/workflows/index.ts`, `src/workflows/index.int.test.ts`

**Produces:** DBOS configured against `DBOS_SYSTEM_DATABASE_URL` with a fixed `applicationVersion`, one queue named `default`, `RunState`, and a test helper that launches DBOS on the throwaway database.

- [ ] Test: a two-step workflow whose second step throws once completes on retry, and its first step ran once.
- [ ] Check: `pnpm test`.

### Task 9: Brands and competitors API, OpenAPI

**Files:** `src/contracts/common.ts`, `src/contracts/brands.ts`, `src/http/brand.ts`, `src/domain/brands/index.ts`, `routes.ts`, `routes.int.test.ts`, `scripts/openapi.ts`, `openapi.json`

**Routes:**

- `GET` and `POST /api/brands`
- `GET` and `PATCH /api/brands/{brandId}`, and `POST /api/brands/{brandId}/archive`
- `GET` and `POST /api/brands/{brandId}/competitors`, and `PATCH` and `DELETE …/competitors/{id}`
- `GET /api/brands/{brandId}/sources`, `POST …/sources/uploads`, and `POST …/sources/{id}/complete`
- `GET /api/brands/{brandId}/costs` (month total and per-run rows)
- `GET /api/brands/{brandId}/audit`

- [ ] Test: creating a brand returns 201 and writes an audit event; a second brand with the same name gets a different slug.
- [ ] Test (review focus 5): the name `हिमाल पश्मिना` gets a non-empty unique slug.
- [ ] Test: archiving a brand keeps its audit and cost rows.
- [ ] Test: brand B's competitor requested through brand A's path returns 404 and one `denied` audit event. The same holds for brand B's source and its `complete` route, so no presigned URL for B's object is ever issued to A.
- [ ] Test: `pnpm openapi:check` fails when `openapi.json` is stale.
- [ ] Check: `pnpm test && pnpm openapi:check`.

### Task 10: Module stubs

**Files:** `src/modules.ts`, `src/domain/knowledge/index.ts`, `src/domain/research/index.ts`, `src/db/schema/knowledge.ts`, `src/db/schema/research.ts`, `src/contracts/knowledge.ts`, `src/contracts/research.ts`, `src/workflows/brand-import.ts`, `src/workflows/research-watch.ts`

Each module `index.ts` exports `routes` (an empty `OpenAPIHono`) and the knowledge one also exports `approvedFacts`, returning `[]`. `modules.ts` mounts both routers and imports both workflow files. The other stub files export nothing.

- [ ] Test: the app starts with both stubs mounted, and `approvedFacts` returns `[]`.
- [ ] Check: `pnpm test && pnpm typecheck`.

### Task 11: Web shell

**Files:** `web/next.config.ts`, `web/package.json`, `web/playwright.config.ts`, `web/e2e/base.spec.ts`, `web/src/nav.ts`, `web/src/lib/api/*`, `web/src/components/app/*`, `web/src/app/(app)/**` as laid out in `docs/structure.md` section 3

**Produces:** the seven shared components of `docs/structure.md` section 5, the scripts `api:types` and `e2e`, and placeholder pages at `/app/b/[brandId]/brand` and `/app/b/[brandId]/research`. Navigation: Home, Brand, Research, in that order.

- Design the shell and the shared components with the `impeccable` skill if it is available to you, as product UI and not a marketing page. Use theme tokens only, Geist with Noto Sans Devanagari, and honour `prefers-reduced-motion`.
- Every shared component is keyboard-usable and labelled (WCAG 2.2 AA).

- [ ] E2E: open `/app/brands`, create a brand, see it in the list, open it, and see its name as the active brand on both placeholder pages.
- [ ] E2E: `/app/brands` with the API stopped shows the `StateBlock` error state, not a blank page.
- [ ] Check: `pnpm build` passes and still reports `/` as static; `pnpm e2e` passes.

## Hand-off

Reply with at most 150 words: which checks pass, anything skipped and why, and any contract in `docs/structure.md` section 4 you had to change, with the exact new signature.
