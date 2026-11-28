# Status

Where the product stands, for the owner and for whoever deploys it. Everything here was read from the code, the `package.json` scripts and the module designs. The test suites were not run to write it, so "tests" below means the test files that exist, not a pass count.

## 1. What is built

Everything runs against the mock model. The API and the screens exist for each module below; `web/src/nav.ts` lists them all.

| Module | Server (`server/src/domain/`) | Server tests (unit / integration files) | Web screens | Web e2e (`web/e2e/`) |
|---|---|---|---|---|
| Brands, sources, costs, audit (base) | `brands`, `sources`, `costs`, `audit` | 5 / 4 | brand list, new brand | `base.spec.ts` |
| Brand | `knowledge` | 4 / 6 | `brand/` (facts, review, sources, visual identity, brand book with readiness answered in place and drafts of the hard fields) | `brand.spec.ts`, `brand.stub.spec.ts` |
| Research | `research` | 2 / 5 | `research/` (competitors, opportunities, battlecards) | `research.spec.ts`, `research.stub.spec.ts` |
| Plan | `plan` | 2 / 5 | `plan/` (calendar, campaigns, settings) | `plan.spec.ts`, `plan.stub.spec.ts` |
| Studio | `studio`, `render/` | 2 / 4, plus 1 render test | `studio/` (dashboard, draft editor) | `studio.spec.ts`, `studio.stub.spec.ts` |
| Approve | `approve` | 1 / 4 | `approve/` (queue, version preview, settings) | `approve.spec.ts`, `approve.stub.spec.ts` |
| Publish | `publish` | 2 / 5 | `publish/` (calendar, channels, jobs, settings) | `publish.spec.ts`, `publish.stub.spec.ts` |
| Home | `home` | 1 / 2 | the brand's first page | `home.spec.ts`, `home.stub.spec.ts` |

Across modules: `server/src/isolation.int.test.ts` (every route against another tenant's brand), `server/src/seams.int.test.ts` (one post through the real Brand, Plan, Studio, Approve and Publish modules), `web/e2e/a11y.stub.spec.ts`, `lib.stub.spec.ts`, `run-progress.stub.spec.ts` (shared components).

Publish works with a manual channel (the owner posts by hand and confirms with the link) and with a mock connector that only tests can use. A connector for a real platform is one file under `domain/publish/connectors/` implementing `Connector`.

## 2. Deliberately left out of each module

From each design's "not in this sprint" section (the Brand design lists non-goals instead).

| Module | Left out | Why |
|---|---|---|
| Brand | Login, users, roles and MFA | The owner said no auth for now |
| Brand | Embeddings and vector search over sources | Studio was expected to be the first to need retrieval; it does not use them |
| Brand | PPTX and XLSX parsing, audio and video transcripts, OCR of scanned PDFs | The owner can upload a PDF export instead |
| Brand | Channel connections, website tracking, CRM settings, quiet hours, auto-actions | Their modules add their own onboarding |
| Research | Screenshots of competitor pages | They need a headless browser on the server. The landing page says "with screenshots saved", so this is a gap against published copy; the saved page text and before and after quotes stand in |
| Research | Public ad library scan | Meta's API needs an approved app and a verified identity; a link field per competitor stands in |
| Research | Competitor discovery, market and trend scans, search gap, AI answer visibility | They need a web search provider, a separate decision; the owner names the competitors |
| Research | Review and voice-of-customer scan | Needs consent and PII handling |
| Research | Social content scan | Platform APIs and policies vary by channel; it belongs with Publish |
| Research | Email or push alerts | There is no user to notify; new observations show on the Research screen |
| Plan | A weekly schedule that drafts the plan on its own | It would spend money without being asked; the owner starts each draft |
| Plan | The fatigue index and planning from past performance | They need the Results module's data |
| Plan | Experiments and paid media plans | They belong with Results and Ads |
| Plan | Drag and drop on the calendar | Items are moved by editing their day |
| Studio | Voice, music, sound effects, subtitles from speech | They need Piper, whisper.cpp and a rights registry for audio; videos have no sound |
| Studio | AI-generated images and video, actors, UGC, product-URL import | Paid providers and synthetic-media rights; templates come first |
| Studio | A timeline editor, transitions, motion graphics | `docs/stack.md` says not to build an editor |
| Studio | Long-form formats (blog, email, landing page) as their own kinds | They get a `post` draft |
| Studio | A separate media worker process | Renders run in the API process |
| Approve | Separate approver logins, client approvers, two-person approval | There is no login |
| Approve | Reminders and escalation | There is nobody to notify |
| Approve | Approval of anything but Studio drafts | Facts, briefs, weeks and battlecards are approved in their own modules; the record can take other object types later |
| Approve | Publication windows and quiet hours | They belong with Publish |
| Publish | Real platform connectors | No app credentials; platform review takes weeks |
| Publish | Inbox: comments, messages, reply drafts | Needs real connections and has its own privacy rules |
| Publish | Platform analytics | They come with real connectors and Results |
| Publish | Evergreen recycling | Needs performance data |
| Publish | Reddit, Pinterest | Plan does not offer them |

## 3. Not built at all

| Item | State |
|---|---|
| Login and users | No authentication or roles anywhere in `server/src`. Every request acts as the one tenant named by `TENANT_SLUG`, and every audit row has the actor `operator` |
| Leads module | No code, table, route or screen |
| Results module | No code, table, route or screen |
| Real platform connectors | Only `manual` and `mock` exist in `domain/publish/connectors/`; no route creates a mock channel |
| Inbox | No code |
| A real model provider key and a live run | `ai/registry.ts` lists one real model (`anthropic:claude-opus-5-5`) and `ai/index.ts` can call it, but `vitest.config.ts` and the e2e server force `AI_MODEL=mock`, so no test makes a paid call and the real path has not been exercised by them |

## 4. Before the server is exposed to the internet or to a second tenant

- **Add login.** Nothing checks who is calling. Until it exists the API must stay behind something that does (it listens on 127.0.0.1 only).
- **Make the tenant a property of the request.** `currentTenantId()` resolves one tenant from `TENANT_SLUG` once per process. A second tenant needs the tenant to come from the logged-in user, and `actor` in audit and approval rows to be the user, not `operator`.
- **Add rate limiting.** `app.ts` sets security headers and a 1 MB body limit only. Model-spending routes are limited by the monthly cap, not by request rate.
- **Real storage credentials.** The dev SeaweedFS accepts any key pair. With `NODE_ENV=production` the API refuses development storage and database values, but the bucket itself must be private; downloads and uploads use 15-minute presigned URLs.
- **Route `/api` on the same hostname** (nginx), as `docs/stack.md` describes; the API sets no CORS headers.
- **Separate approvers.** With one operator, the person who drafts is the person who approves.
- **Check the shortcuts in section 5** that involve more than one process.

## 5. Known limits and shortcuts

Every comment of the form `shortcut:` in the code.

| File | Stated limit |
|---|---|
| `server/src/storage/index.ts` (`presignUpload`) | A presigned PUT cannot cap the size, so `completeUpload` checks the maximum on the stored object. Move to a presigned POST with `content-length-range` if large rejected uploads cost too much |
| `server/src/ai/estimate.ts` (`pdfPages`) | A PDF that hides its page objects in compressed object streams is estimated at one page per 50 KB. Parse with pdf.js if such estimates prove far off |
| `server/src/domain/research/watch/prompts.ts` | A page longer than 40,000 characters is cut for the model; the quote check still reads the whole text |
| `server/src/domain/brands/index.ts` (`uniqueSlug`) | Two brands created at the same instant with the same name can race to one slug; the unique index answers 409 and a retry succeeds |
| `server/src/domain/knowledge/import/prompt.ts` | One source's text is cut at about 100,000 tokens; split long documents if that bites |
| `server/src/domain/knowledge/palette/colour.ts` | Named colours, `lab()`, `lch()` and `color-mix()` are skipped when reading a site's palette, and only the first 4 linked stylesheets are read |
| `server/src/domain/knowledge/import/site.ts` | An inline SVG logo and `og:image` are never logo candidates (no file, or usually a banner photo); a site whose logo is only inline SVG gets none, and the owner uploads it |
| `server/src/domain/sources/fetch.ts` (`politeWait`) | Per-host pacing is per-process memory, so several API processes each keep their own pace. Move it to a DBOS queue rate limit when fetching runs on more than one process |
| `server/src/domain/sources/fetch.ts` (`robotsCache`) | `robots.txt` is cached per process for an hour |
| `server/scripts/e2e-control.ts` | The fetch guard checks addresses, not ports, so every port on 127.0.0.1 opens. Only the throwaway e2e process does this |

## 6. What a deployment must set

Read from `server/.env.example` and `server/src/config.ts`. With `NODE_ENV=production` the API refuses to start while a database URL, an S3 value or the model key is unset or a development value, or `AI_MODEL` is `mock`.

| Variable | For | Production |
|---|---|---|
| `NODE_ENV` | `production` turns on the refusals above | Must set to `production` |
| `PORT` | The API's port, bound on 127.0.0.1 (default 8000) | Set to the port nginx proxies to |
| `DATABASE_URL` | The app role (`marketing_app`): no `BYPASSRLS`, no update or delete on `audit_events` or `approvals` | Must set; not a development password |
| `DATABASE_ADMIN_URL` | The owner role: `pnpm db:migrate`, test databases | Must set; not a development password |
| `DBOS_SYSTEM_DATABASE_URL` | Where DBOS keeps workflow state | Must set; not a development password |
| `S3_ENDPOINT`, `S3_BUCKET` | The S3-compatible store (SeaweedFS in development) | Must set (unset is refused); the bucket is created at start if missing |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Storage credentials | Must set; `dev` is refused |
| `AI_MODEL` | `mock`, or a model in `ai/registry.ts` (default `anthropic:claude-opus-5-5`) | `mock` is refused |
| `ANTHROPIC_API_KEY` | The provider key | Must set while `AI_MODEL` starts with `anthropic:` |
| `AI_MONTHLY_CAP_NPR` | The tenant's AI spend cap per calendar month (UTC); default 5000 | Set deliberately |
| `USD_NPR` | The exchange rate used to price calls; default 155.08 | Set to the current rate |
| `TENANT_SLUG` | The one tenant (default `xenextech`); `pnpm seed` creates it | Seed it once with `pnpm seed` |
| `NODE_APP_INSTANCE` | Names this process's DBOS executor | Must be set for each process; see below |
| `RESEARCH_RUN_CAP_NPR` | The most one scheduled competitor check may spend; default 150. Read directly from the environment, not by `config.ts` | Optional |
| `LOG_LEVEL` | pino level; default `info` | Optional |

Also needed on the host: `ffmpeg` on the PATH for video drafts (without it a video render fails with `RenderUnavailable`). No migration uses the pgvector extension, though the dev compose file runs the pgvector image.

**Executor IDs.** Production runs the API as more than one process, and DBOS recovers unfinished workflows by executor ID, so two processes must never share one: each would recover, and run again, the workflows the other is running. `executorId()` in `server/src/workflows/index.ts` gives `api-<NODE_APP_INSTANCE>` when the variable is set and `local` when it is not. pm2 sets `NODE_APP_INSTANCE` (0, 1, …) for each cluster instance, so under pm2 cluster mode nothing more is needed; any other way of running two processes must set it by hand. `config.ts` accepts digits only. After lowering the instance count, recover the removed IDs' workflows with `DBOS.recoverWorkflows`. `APPLICATION_VERSION` is fixed at `'1'` so a restarted process recovers its predecessor's runs; bump it only with a deliberate migration of in-flight runs.

Migrations: run `pnpm db:migrate` as the owner role (it applies `src/db/migrations`, creates the app role from the password in `DATABASE_URL`, and applies the grants in `src/db/setup.ts`). Deploy `server/` before `web/` when the API changes (`docs/stack.md`).
