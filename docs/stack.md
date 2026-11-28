# Stack recommendation: AI Marketing Operating System

For the developers taking the handover and for the devops engineer who runs the shared Contabo box. It settles the technology side of ADR-001 to ADR-012 (spec §20.1). Requirements come from `AI_Marketing_Operating_System_specs.md`. Server conventions come from `docs/contabo-server.md` in the xenex workspace root (`../../docs/contabo-server.md` from this file).

Versions and licences were checked on 2026-11-27 against npm, GitHub and vendor pages; each row cites its source. NPR conversions use the Nepal Rastra Bank selling rates of 2026-10-12: USD 1 = NPR 155.08, EUR 1 = NPR 173.72 ([source](https://www.sharesansar.com/newsdetail/nrb-publishes-mondays-forex-rates-us-dollar-fixed-at-rs-15508-2026-10-12)).

The approach: one language (TypeScript), one database (Postgres), and no new servers to operate. Postgres holds all of these: workflow state, queues, vectors, auth, audit and the cost ledger. There is no Redis, no separate workflow cluster, no separate auth server and no LLM proxy.

## 1. The stack in one table

| Layer | Pick | Version | Licence | Why | Source |
|---|---|---|---|---|---|
| Language | TypeScript, pinned per project (`web/` is on 5.x as scaffolded; latest is 7.0.2) | 5.x / 7.0.2 | Apache-2.0 | One language for web, API, workflows and workers | [npm](https://www.npmjs.com/package/typescript) |
| Runtime | Node.js "Lithium" | 26 LTS | MIT | Current LTS; runs under the house pm2 setup | [nodejs.org](https://nodejs.org/en/about/previous-releases) |
| Repo | Independent projects `web/` and `server/`. Each has its own `package.json`, pnpm lockfile, build, CI and deploy. No workspace, no shared packages | pnpm 12 (`web/` pins 12.11.2) | MIT | Each project builds and deploys alone, which fits the house one-folder deploy | [npm](https://www.npmjs.com/package/pnpm) |
| Frontend: landing page and product UI | Next.js App Router in `web/`, React, Tailwind, shadcn registries (React Bits, Kokonut UI, Watermelon UI), anime.js, TanStack Query | Next 16.4.6, React 19.3.0, Tailwind 4.3.3 (as scaffolded), shadcn 4.23.1, TanStack Query 5.108.4 | MIT | One app: `/` is prerendered static, the product sits under its own route group | [next](https://www.npmjs.com/package/next), [react](https://www.npmjs.com/package/react), [tailwindcss](https://www.npmjs.com/package/tailwindcss), [shadcn](https://www.npmjs.com/package/shadcn), [react-query](https://www.npmjs.com/package/@tanstack/react-query) |
| API and domain | Hono on `@hono/node-server`, `@hono/zod-openapi`, Zod, in `server/` | Hono 4.13.23, node-server 2.1.11, zod-openapi 1.6.3, Zod 4.6.7 | MIT | Small, uses Web-standard handlers, generates the OpenAPI spec from schemas | [hono](https://github.com/honojs/hono/releases), [zod-openapi](https://www.npmjs.com/package/@hono/zod-openapi), [zod](https://www.npmjs.com/package/zod) |
| Contract between web and server | `server/openapi.json`, generated from the Zod schemas; `web/` generates types with openapi-typescript and calls the API with openapi-fetch | 7.13.0 / 0.17.0 | MIT | Typed client with no shared TypeScript package | [openapi-typescript](https://www.npmjs.com/package/openapi-typescript), [openapi-fetch](https://www.npmjs.com/package/openapi-fetch) |
| Auth, RBAC, MFA | Better Auth (organization and two-factor plugins) plus Postgres row-level security | 1.7.28 | MIT | Organisations, roles, invitations and TOTP run inside the API process | [GitHub](https://github.com/better-auth/better-auth/releases) |
| Relational DB | PostgreSQL | 18.7 | PostgreSQL License | Mature major release; 19.0 is only 8 days old | [postgresql.org](https://www.postgresql.org/support/versioning/) |
| Vector search | pgvector, image `pgvector/pgvector:0.8.7-pg18` | 0.8.7 | PostgreSQL License | Brand-filtered RAG in the same database and transaction | [changelog](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md), [LICENSE](https://github.com/pgvector/pgvector/blob/master/LICENSE), [tags](https://hub.docker.com/r/pgvector/pgvector/tags) |
| ORM and migrations | Drizzle ORM and drizzle-kit | 0.45.4 / 0.31.11 (1.0.0-rc.6 in RC) | Apache-2.0 / MIT | RLS policies and the vector type defined in the schema; DBOS has a Drizzle datasource | [drizzle-orm](https://www.npmjs.com/package/drizzle-orm), [drizzle-kit](https://www.npmjs.com/package/drizzle-kit) |
| Durable workflows and queues | DBOS Transact (TypeScript), open-source library only | 5.7.0 | MIT | A library on Postgres, with no extra server; covers pause, resume, cancel, fork, cron, queues and rate limits | [GitHub](https://github.com/dbos-inc/dbos-transact-ts/releases), [npm](https://www.npmjs.com/package/@dbos-inc/dbos-sdk) |
| AI gateway | Vercel AI SDK with `@ai-sdk/otel`, behind our own registry, router and cost ledger in `server/src/ai` | ai 7.0.183, otel 1.0.183 | Apache-2.0 | Provider-neutral calls in the same process; we compute cost from our own rate snapshots | [ai](https://www.npmjs.com/package/ai), [otel](https://www.npmjs.com/package/@ai-sdk/otel) |
| Local LLM and embeddings (T1) | Ollama on a GPU box, via `ollama-ai-provider-v2` | 0.40.18 / 4.1.0 | MIT / Apache-2.0 | Spec §15.3 candidate; reached over HTTPS | [ollama](https://github.com/ollama/ollama/releases), [provider](https://www.npmjs.com/package/ollama-ai-provider-v2) |
| Speech to text | whisper.cpp (CLI) | 1.9.6 | MIT | Small models run on CPU, enough for short-clip subtitles | [GitHub](https://github.com/ggml-org/whisper.cpp/releases) |
| Text to speech | Piper (`piper1-gpl`), run as a separate process | 1.8.0 | GPL-3.0 | Low-cost local voice; each voice has its own licence | [GitHub](https://github.com/OHF-Voice/piper1-gpl) |
| Image diffusion (optional) | ComfyUI on the GPU box, called over HTTP | 0.46.0 | GPL-3.0 | Only if the GPU benchmark justifies it | [GitHub](https://github.com/comfyanonymous/ComfyUI/releases) |
| Video rendering | FFmpeg CLI, from the Ubuntu 24.04 package | 6.1.1 (upstream 9.1) | LGPL-2.1+ / GPL-2+ by build | Deterministic templates, captions, resizing and batch output with no licence fee | [Launchpad](https://launchpad.net/ubuntu/noble/+source/ffmpeg), [ffmpeg.org](https://ffmpeg.org/download.html), [legal](https://ffmpeg.org/legal.html) |
| Static images and carousels | Satori with resvg-js (JSX to SVG to PNG) | 0.63.2 / 2.6.2 | MPL-2.0 | Brand templates written in TSX, with no headless browser | [satori](https://www.npmjs.com/package/satori), [resvg-js](https://www.npmjs.com/package/@resvg/resvg-js) |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` (SeaweedFS for local dev and CI) | SDK 3.1178.0, SeaweedFS 4.55 | service / Apache-2.0 | No egress fees, data kept off the box, standard S3 API | [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [sdk](https://www.npmjs.com/package/@aws-sdk/client-s3), [SeaweedFS](https://github.com/seaweedfs/seaweedfs/releases) |
| Social publishing | Our own adapters behind the §20.2 connector contract, for 2–3 pilot channels | n/a | own code | Postiz needs 9 containers; see ADR-005 | n/a |
| Observability | OpenTelemetry JS SDK, exporting to OpenObserve (single node, Docker) | sdk-node 0.301.2, OpenObserve 1.2.0 | Apache-2.0 / AGPL-3.0 | One container for logs, metrics and traces; telemetry stays on the box | [sdk-node](https://www.npmjs.com/package/@opentelemetry/sdk-node), [OpenObserve](https://github.com/openobserve/openobserve/releases) |
| App logs | pino to stdout, written to files by pm2 | 10.4.0 | MIT | House log convention | [npm](https://www.npmjs.com/package/pino) |
| Process manager | pm2 (house standard) | 7.1.2 | AGPL-3.0 | Already runs every app on the box | [npm](https://www.npmjs.com/package/pm2) |
| System email | Nodemailer over the existing SMTP account | 10.6.1 | MIT-0 | Invitations, approval reminders, alerts | [npm](https://www.npmjs.com/package/nodemailer) |
| Tests | Vitest (unit, integration, isolation), Playwright (E2E) | 5.1.2 / 1.65.1 | MIT / Apache-2.0 | Integration tests run against a real Postgres container | [vitest](https://www.npmjs.com/package/vitest), [playwright](https://www.npmjs.com/package/@playwright/test) |

## 2. Per layer: the pick, the runner-up, and why

### ADR-001: modular monolith, API placement, repo layout

**Pick:** two independent projects in one repo. Each has its own `package.json`, lockfile, build, CI and deploy, and nothing is shared through workspace packages.

- `web/` is the Next.js app. It holds no business logic and does no database access.
- `server/` is a modular monolith: the Hono API, Better Auth, DBOS workflows and the media worker. The media worker is a second entrypoint and a second pm2 process of the same project, because it needs the same workflow definitions and DB schema.

Add another top-level project only if a layer truly needs its own runtime or deploy cycle. None does today.

**Why the API is not in Next.js route handlers:**

- DBOS's own Next.js guide says running DBOS inside the Next.js process "is difficult" because Next.js "may evaluate modules … multiple times in different contexts". It recommends a separate worker process ([DBOS + Next.js](https://docs.dbos.dev/integrations/nextjs)). That worker would hold the workflows anyway. Splitting business rules between Next.js handlers and that worker would give two homes for the same domain.
- Workflows, webhooks and OAuth callbacks must keep running while the UI is redeployed.
- The spec requires an OpenAPI contract (§23.2). It is generated from the same Zod schemas the handlers use.

**Runner-up:** Next.js route handlers that enqueue work through `DBOSClient`, with one worker process. It was rejected for the reason above: business rules would live in two places.

**Contract between the two projects:** the OpenAPI document is the only interface.

1. `server/` writes `openapi.json` from its `@hono/zod-openapi` routes (`pnpm openapi`) and commits it.
2. `web/` runs openapi-typescript on that file to get a `paths` type, and calls the API through openapi-fetch.
3. `server/` CI fails if the committed `openapi.json` is out of date.
4. `web/` CI fails if its generated types differ from the committed spec.

A breaking API change therefore shows up as a diff in `openapi.json`. Deploy `server/` before `web/` whenever the API changes.

**Same-origin routing:** nginx sends `/api/*` to `server/` on the same hostname. Cookies stay first-party and no CORS is needed. Product pages are client components that use TanStack Query and openapi-fetch against `/api`.

The landing page is `web/src/app/(marketing)/page.tsx`. It has its own root layout and is prerendered static. The product lives in `web/src/app/(app)/` with its own root layout. Next.js reloads the full page when crossing between two root layouts, and it requires `/` to be defined inside one of the groups ([route groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)).

```
marketing/
├─ web/                 Next.js project (own package.json, pnpm-lock.yaml, CI, deploy).
│  ├─ src/app/(marketing)/   Landing page "/", prerendered static, own root layout.
│  ├─ src/app/(app)/         Product UI, own root layout. Calls /api only.
│  ├─ src/components/        shadcn registry code (React Bits, Kokonut UI, Watermelon UI).
│  └─ src/lib/api/           Generated openapi-typescript types and the openapi-fetch client.
├─ server/              Node project (own package.json, pnpm-lock.yaml, CI, deploy).
│  ├─ src/main.ts            Entrypoint 1: Hono HTTP API, Better Auth, webhooks, DBOS executor (all queues except "media").
│  ├─ src/media.ts           Entrypoint 2: DBOS executor listening only to "media" (FFmpeg, whisper.cpp, Piper, Satori).
│  ├─ src/db/                Drizzle schema, migrations, RLS policies, withTenant(tx) helper, seed.
│  ├─ src/contracts/         Zod schemas for requests, responses, and role and workflow JSON schemas. Source of openapi.json.
│  ├─ src/domain/            Business modules (brands, knowledge, content, approvals, publishing, crm, analytics, costs, audit).
│  ├─ src/workflows/         DBOS workflows WF-001..024 and queue definitions.
│  ├─ src/ai/                Provider registry, router (tiers T0–T4, privacy class), cost ledger, AI SDK adapters, eval harness.
│  ├─ src/connectors/        Connector contract (§20.2) and adapters (social, CRM, email, WhatsApp, analytics).
│  ├─ src/render/            FFmpeg/Satori presets and wrappers (used by the media entrypoint only).
│  └─ openapi.json           Generated and committed; the contract web/ builds against.
├─ deploy/vps/          Not a project: copies of every file installed on the box (deploy script,
│                       ecosystem.config.js, nginx site, compose file for Postgres and OpenObserve).
└─ docs/
```

Keep module boundaries inside `server/src` with plain imports. Each module exposes an `index.ts`, and other modules import nothing else from it. Promote a module to its own project only when it needs its own runtime or deploy cycle.

### ADR-002: backend framework

**Pick:** Hono 4.

- Better Auth exposes a fetch handler, which mounts directly on Hono.
- `@hono/zod-openapi` produces the OpenAPI document from the same schemas used for validation. That document is the web/server contract (ADR-001).
- Hono's RPC client (`hc`) is not used. It needs the server's TypeScript types inside `web/`, which independent projects rule out. It also slows IDE type-checking as the route count grows ([Hono RPC](https://hono.dev/docs/guides/rpc)).
- Hono 5 is in RC ([npm](https://www.npmjs.com/package/hono)). Stay on 4 until 5 is GA.

**Runner-up:** Fastify 5.12.8 (MIT, [npm](https://www.npmjs.com/package/fastify)). It is mature and has plugin encapsulation, but needs extra adapters for Web-standard handlers and Zod/OpenAPI.

**Rejected:** NestJS 12.6.3 (MIT, [npm](https://www.npmjs.com/package/@nestjs/core)). Its decorator and DI layer adds structure that the `server/src` module boundaries already give, at a cost in boilerplate.

### ADR-003: auth, RBAC and isolation

**Pick:** Better Auth.

- An organisation is a tenant. Membership, invitations and static or dynamic roles come from the organization plugin ([docs](https://www.better-auth.com/docs/plugins/organization)).
- MFA uses the two-factor plugin: TOTP, backup codes and trusted devices ([docs](https://www.better-auth.com/docs/plugins/2fa)).
- Privileged actions require a fresh session (`freshAge`, [docs](https://www.better-auth.com/docs/concepts/session-management)) plus a TOTP re-check (§17).

**Brand-level roles** (operator, approver, contractor, client approver) live in our own `brand_memberships` table, not in Better Auth teams. This keeps the cross-brand deny-by-default rule in one place.

**Isolation (NFR-006):**

- Every tenant-owned table carries `tenant_id` and `brand_id` and has Postgres RLS policies defined in the Drizzle schema (`pgPolicy`, [docs](https://orm.drizzle.team/docs/rls)).
- The app connects as a role without `BYPASSRLS`.
- Every request and every workflow step runs inside a transaction that first runs `set_config('app.tenant_id', …, true)` and `set_config('app.brand_ids', …, true)`.
- Isolation tests hit the API, the database, vector search, storage key prefixes and workers.

**Ownership changes:** Auth.js moved under Better Auth in September 2025 ([post](https://better-auth.com/blog/authjs-joins-better-auth)). Vercel acquired Better Auth on 2026-07-07 and states it stays open source ([Vercel](https://vercel.com/blog/vercel-acquires-better-auth)). The risk is small because all auth data sits in our own Postgres tables.

**Runner-up:** a separate identity server such as Keycloak, which OpenBuzz ships with. It adds a JVM service to run and patch, with no gain at pilot scale.

### Data layer: PostgreSQL 18, pgvector, Drizzle (supports ADR-003, ADR-010)

**Postgres:** use PostgreSQL 18.7. PostgreSQL 19.0 shipped on 2026-11-19 ([versioning](https://www.postgresql.org/support/versioning/)). pgvector's changelog does not mention 19 yet ([changelog](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md)). Revisit 19 in mid-2027.

**Database rules:**

- Money is `numeric`, timestamps are `timestamptz` in UTC.
- Audit events go in an append-only table; the app role has no `UPDATE` or `DELETE` grant on it.
- `cost_events` stores the rate snapshot with each row (§15.2).
- DBOS keeps its state in a separate system database on the same Postgres container.

**ORM:** Drizzle 0.45.4. Version 1.0 is in RC (1.0.0-rc.6, 2026-11-20, [npm](https://www.npmjs.com/package/drizzle-orm)). Upgrade when 1.0 is GA; v1 replaces `.enableRLS()` with `pgTable.withRLS`.

**Runner-up:** Prisma 7.10.1. Prisma 7 still maps vector columns to `Unsupported("vector")` and raw SQL ([docs](https://www.prisma.io/docs/postgres/database/postgres-extensions)). Native pgvector support exists only in the 8.0 RC ([blog](https://www.prisma.io/blog/prisma-orm-8-closes-330-most-requested-issues)). RLS in Prisma needs client extensions.

### ADR-004: workflow engine and licence

**Pick:** DBOS Transact 5.7.0 (MIT). It is a library: workflows are checkpointed in Postgres inside our own processes.

How the spec's §14.1 requirements map to DBOS (references: [queues](https://docs.dbos.dev/typescript/tutorials/queue-tutorial), [workflow management](https://docs.dbos.dev/typescript/tutorials/workflow-management), [upgrading workflows](https://docs.dbos.dev/typescript/tutorials/upgrading-workflows.md)):

| Spec requirement | DBOS feature |
|---|---|
| Cron triggers | Scheduled workflows |
| Durable sleep and delays | `DBOS.sleep` |
| Event and webhook triggers, idempotency | Enqueue with `deduplicationID`; the workflow ID is the idempotency key |
| Queues | `globalConcurrency`, `workerConcurrency`, `rateLimit` |
| Per-brand rate limits and quiet hours | Partitioned queues keyed by `brand_id` |
| Cancel, resume, replay from failed node | `cancelWorkflow`, `resumeWorkflow`, `forkWorkflow` / `rewindWorkflow` from a step |
| Dead-letter view | List workflows in `ERROR` status |
| Separate media worker pool | `listenQueues`, so only the `server/src/media.ts` process dequeues `media` |

**Operating rules** (only the free MIT library is used):

1. **Executor IDs:** give each pm2 instance a stable ID, `executorID: \`api-${NODE_APP_INSTANCE}\``. A restarted executor recovers its own pending workflows. If you reduce the instance count, call `DBOS.recoverWorkflows([...])` for the removed IDs ([recovery](https://docs.dbos.dev/production/workflow-recovery.md)).
2. **Application version:** pin `applicationVersion` to a fixed value and use `DBOS.patch()` for breaking changes to workflow code. Executors only resume workflows of their own application version, so a new version on every deploy would strand in-flight runs. Auto-upgrade between versions is an Enterprise feature ([Enterprise](https://docs.dbos.dev/explanations/transact-enterprise.md)). The spec's own workflow definition version (§14.1, "pinned to workflow version") travels as workflow input.
3. **Approval holds:** model them as data. A run ends at `awaiting_approval`. The approval decision enqueues the next workflow, de-duplicated by approval version. Do not park workflows in multi-day `recv` waits, because suspending them during long waits is an Enterprise feature and a waiting run holds its queue slot. WF-007 reminders run on a cron.
4. **Operations screen:** build the Automation screen (§17) on the management API above. DBOS Conductor and its console are commercial and not needed.
5. **No port:** DBOS 5.x removed its admin server, so it takes no port on the box (the `adminPort` type is marked "Ignored: the admin server has been removed" in the 5.7.0 package typings).

**Runner-up:** pg-boss 12.40.0 (MIT). It offers cron, retries, priority, dead-letter, debounce and concurrency policies on Postgres ([GitHub](https://github.com/timgit/pg-boss)), but no step checkpoints, so we would hand-build workflow state.

**Rejected:**

| Engine | Licence | Why rejected |
|---|---|---|
| Graphile Worker 0.18.0 | MIT ([GitHub](https://github.com/graphile/worker)) | A job queue only |
| Hatchet v0.120.24 | MIT ([GitHub](https://github.com/hatchet-dev/hatchet/releases)) | Separate engine, API and dashboard; RabbitMQ optional ([docs](https://docs.hatchet.run/self-hosting)) |
| Temporal 1.32.2 | MIT ([GitHub](https://github.com/temporalio/temporal/releases)) | Server, UI, persistence database and Elasticsearch visibility store ([docs](https://docs.temporal.io/self-hosted-guide/deployment)) |
| Trigger.dev v4.8.10 | Apache-2.0 ([GitHub](https://github.com/triggerdotdev/trigger.dev)) | Self-hosting needs Postgres, Redis, ClickHouse, a registry and object storage, on machines of 3+ vCPU/6 GB plus 4+ vCPU/8 GB ([docs](https://trigger.dev/docs/self-hosting/docker)) |
| Inngest server v1.53.0 | SSPL-1.0 with an "Apache 2.0 Future License" ([LICENSE](https://github.com/inngest/inngest/blob/main/LICENSE.md)) | Licence; see ADR-011 |

### ADR-006: model gateway and local hardware

**Pick:** the AI SDK 7, in the same process, behind the `server/src/ai` module.

`server/src/ai` owns these parts:

- The provider registry (§15.1).
- The tier router T0–T4. A request's privacy class can only narrow the set of allowed providers; a local-only task never falls back to a hosted provider.
- Budgets with hard caps.
- The `cost_events` ledger. It records estimated and actual cost, retries and failed generations.

The AI SDK records token and usage counts as OpenTelemetry `gen_ai.*` attributes but does not compute currency cost ([telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)). The ledger multiplies usage by our own rate snapshot, which the spec requires anyway. For private-class calls, turn off prompt and response recording in telemetry. Ollama support comes from a community provider that includes embeddings ([provider](https://ai-sdk.dev/providers/community-providers/ollama)).

**Rejected: the LiteLLM proxy** (MIT plus an enterprise directory, [LICENSE](https://github.com/BerriAI/litellm/blob/main/LICENSE)):

- It is a second language (Python) and a second process with its own database.
- Its spend tracking would duplicate the ledger, which must stay the system of record.
- It had two supply-chain compromises in 2026: PyPI 1.82.7 and 1.82.8 in March ([LiteLLM](https://docs.litellm.ai/blog/security-update-march-2026)), and 1.107.0 including Docker images in October ([Cloudsmith](https://cloudsmith.com/blog/litellm-1-107-0-compromised-on-pypi)).

**Local hardware:** Ollama and ComfyUI run on a GPU box, not on the shared VPS (see §3). Select models per task with the §15.4 benchmark, including the Nepali language tasks, during Phase 0.

### ADR-007: media storage and rendering

**Storage pick:** Cloudflare R2.

- Prices: storage USD 0.015 per GB-month, Class A operations USD 4.50 per million, Class B USD 0.36 per million, egress free. The free tier covers 10 GB-month ([pricing](https://developers.cloudflare.com/r2/pricing/)).
- The shared VPS disk is small: Contabo lists the Cloud VPS 6 with 100 GB NVMe or 200 GB SSD ([product list](https://contabo.com/en/product-list/?show_ids=true)). The same disk also holds every other project's data and backups.
- Uploads and downloads go directly to R2 through presigned URLs.
- Object keys are prefixed `tenant/brand/…`, and the isolation tests cover them.

**Self-hosted options if data must stay on our hardware:** SeaweedFS 4.55 (Apache-2.0) or RustFS 1.0.7 (Apache-2.0, [GitHub](https://github.com/rustfs/rustfs/releases)). Garage is AGPL-3.0 ([repo](https://github.com/deuxfleurs-org/garage)).

**MinIO is out.** Its community edition went into maintenance mode in December 2025 and ships as source only. The GitHub repo is archived, with no new binaries ([InfoQ](https://www.infoq.com/news/2025/12/minio-s3-api-alternatives/), [repo](https://github.com/minio/minio)).

**Rendering pick:** FFmpeg templates in `server/src/render`, run by the media entrypoint (`server/src/media.ts`):

- FFmpeg handles concat, overlays, drawtext, libass captions and resize presets.
- Satori and resvg-js render statics and carousels.
- whisper.cpp writes subtitles.
- Piper produces voice.

Use the Ubuntu FFmpeg package (6.1.1), which gets security updates through unattended-upgrades. Switch to an upstream 9.x static build only if a preset needs a newer filter.

**Remotion is deferred.** It is free only for individuals and companies of up to 3 people. Otherwise the "Automators" tier is USD 0.01 per render with a minimum of USD 100 a month ([pricing](https://www.remotion.dev/docs/license/pricing), [LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)). That minimum is about NPR 15,500 a month, or about NPR 1,550 per video at the 10-video pilot: five times the NPR 300 target before any compute cost.

**Piper licence:** the original `rhasspy/piper` (MIT) is archived ([repo](https://github.com/rhasspy/piper)). Development continues as GPL-3.0 `piper1-gpl`. Run it as a CLI process and check each voice's licence.

### ADR-012: video provider cost benchmark

This is not a stack choice. The provider registry and cost ledger supply the data. T4 providers (avatar, premium video, dubbing) are adapters in `server/src/ai` and run only with a cost estimate and an explicit approval (§15). Phase 0 runs the benchmark. The FFmpeg template path is the baseline cost every paid provider is compared against.

### ADR-005: Postiz/OpenBuzz vs native social publishing

**Pick:** our own adapters, implementing the full §20.2 contract (`reconcile()`, capability errors, `UNKNOWN` after a timeout), for the 2–3 pilot channels only.

**Postiz** is AGPL-3.0, v2.26.0 ([GitHub](https://github.com/gitroomhq/postiz-app/releases)). Its official compose file runs 9 containers ([compose](https://github.com/gitroomhq/postiz-docker-compose)):

- Postiz itself
- Postgres 17
- Redis
- Temporal, plus a Postgres 16 for Temporal
- Elasticsearch
- Temporal UI
- Temporal admin tools
- Sentry Spotlight

That is too heavy for the shared box. It would also duplicate our tenancy, approval and audit model.

Run the Phase 0 Postiz test on a throwaway VPS. If we adopt it later, run it unmodified as a separate service behind the connector contract. Modifying it and exposing it over the network would trigger AGPL source-offer obligations.

**OpenBuzz:** its site states an AGPL-3.0 community edition and a commercial enterprise edition, and says it ships with Postgres and Keycloak ([openbuzz.io](https://openbuzz.io)). The source repo it links (`github.com/nxglabs/OpenBuzz`) returned 404 on 2026-11-27. It is not a candidate until its source and licence file can be inspected.

### ADR-008: CRM, email, WhatsApp

**Integrate, do not rebuild.** Build only these parts:

- The lead record
- Consent and suppression
- Source capture
- Scoring and routing
- An outbound adapter to the brand's chosen CRM and email service

System email (invitations, approvals, alerts) goes through Nodemailer over the existing SMTP account. WhatsApp uses Meta's Cloud API through a connector adapter. The owner picks the providers (§24.1 decision 15).

### ADR-009: analytics and attribution

**Pick:** our own `events` table plus connectors.

- A first-party `/api/e` collector records landing-page and form events, with UTM capture.
- Each connector's `fetch_analytics()` pulls platform metrics.
- Search Console and GA4 come in through connectors where brands use them.
- Attribution is computed in SQL over `events → leads → opportunities`. Its caveats are documented (§24).

**Runner-up:** Umami 3.5.0 (MIT, Postgres, Node 20.19+) if brands need a ready-made web analytics UI ([GitHub](https://github.com/umami-software/umami/releases), [docs](https://docs.umami.is/docs/install)). It would add one more Next.js process.

### ADR-010: hosting, backup, observability

**Hosting** follows the house convention (§3). It is a Docker-portable layout (NFR-008): Postgres runs in Docker, and the apps are plain Node builds.

**Backups:**

- Use the house `pg-backup` nightly cron.
- Copy each dump off the box to a separate R2 bucket. The house backups sit on the same disk, and WF-020 needs off-box recovery evidence.
- Do a monthly restore into a scratch container.
- If the owner sets an RPO under 24 hours, add WAL archiving to R2.

**Observability pick:** OpenObserve single node, one container, storing data on local disk by default. HTTP/OTLP listens on 5080 and gRPC on 5081 ([env vars](https://openobserve.ai/docs/environment-variables/)).

- The API, the workers, the AI SDK and DBOS all export OTLP. DBOS has `enableOTLP` and `otlpTracesEndpoints`.
- Set a retention limit.
- Reach the UI through an SSH tunnel. It is AGPL-3.0, so use it internally and unmodified.

**Runner-up:** Grafana Cloud's free tier. It allows 10k active metric series, 50 GB logs and 50 GB traces a month, with 14-day retention ([pricing](https://grafana.com/pricing/)). It runs nothing on the box, but telemetry leaves our control.

**Rejected:** SigNoz (MIT core plus `ee/`, [LICENSE](https://github.com/SigNoz/signoz/blob/main/LICENSE)). Its ClickHouse backend is too heavy for the box.

### ADR-011: OSS licence register

| Component | Licence | Effect on a hosted SaaS | Status |
|---|---|---|---|
| Inngest server | SSPL-1.0 with an Apache-2.0 future licence ([LICENSE](https://github.com/inngest/inngest/blob/main/LICENSE.md)) | SSPL is not OSI-approved; its §13 service clause needs legal review before any SaaS use | **Excluded** |
| MinIO community | AGPL-3.0; repo archived, source only | No maintained builds | **Excluded** |
| Remotion | Remotion License, source-available ([LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)) | Paid company licence above 3 employees; Automators minimum USD 100 a month | **Deferred** |
| DBOS Enterprise and Conductor | Commercial ([docs](https://docs.dbos.dev/explanations/transact-enterprise.md)) | Not needed; use the MIT library only | Not used |
| Postiz, Garage, OpenObserve | AGPL-3.0 | Fine unmodified as separate services; modifying and exposing over a network triggers a source offer | OpenObserve used internally |
| OpenBuzz | AGPL-3.0 community and commercial EE, per the vendor's site | Source repo not reachable | Unverified |
| pm2 | AGPL-3.0 ([npm](https://www.npmjs.com/package/pm2)) | House tool, unmodified, not distributed | Used |
| Piper, ComfyUI | GPL-3.0 | Fine as separate processes or services; voice and model-weight licences are separate | Used as processes |
| FFmpeg | LGPL-2.1+ or GPL-2+, depending on the build ([legal](https://ffmpeg.org/legal.html)) | Called as a CLI, so it does not link into our code; H.264/AAC patent question goes to legal (§6) | Used |
| Satori, resvg-js | MPL-2.0 | File-level copyleft; fine unmodified | Used |
| LiteLLM, SigNoz | MIT plus an enterprise directory | n/a | Not used |
| Model weights (Ollama, ComfyUI) | Per model | Check commercial-use terms per model before T1 or diffusion selection | Phase 0 |

## 3. Deployment on the existing VPS

### Box headroom: check first

The runbook names the plan "Contabo Cloud VPS 6". Contabo's current list gives that plan as 6 vCPU, 12 GB RAM and 100 GB NVMe or 200 GB SSD ([product list](https://contabo.com/en/product-list/?show_ids=true)). The box already serves about 18 sites, four Postgres containers, two Redis containers and two hydroOS stacks.

Before deploying, run `nproc; free -m; df -h /; docker stats --no-stream` and record the results in the runbook. If less than about 3 GB of RAM is free, put this project on its own VPS from the start. The next plan up, Cloud VPS 8 (8 vCPU, 24 GB), lists at EUR 11.20 a month.

### Processes

The box sees one house project, `marketing`, with two deployable apps, one per repo project. Each lives under `/opt/marketing/<app>/{releases,shared,current}`. One `/opt/marketing/ecosystem.config.js` lists the three pm2 apps.

| Repo project | pm2 app / container | Runs as | Mode | Listens on | Notes |
|---|---|---|---|---|---|
| `web/` | `marketing-web` | pm2 (root) | cluster ×2, Next.js standalone | 127.0.0.1:3040 | Landing page and product UI. Same pattern as CLiQ Campus |
| `server/` | `marketing-api` (entry `src/main.ts`) | pm2 (root) | cluster ×2 | 127.0.0.1:3041 | Hono API, Better Auth, webhooks, and a DBOS executor for every queue except `media`. `executorID` is `api-${NODE_APP_INSTANCE}` |
| `server/` | `marketing-media` (entry `src/media.ts`) | pm2 (root) | fork ×1 | none | Same release as `marketing-api`. DBOS executor `media-0` with `listenQueues: ['media']` and `workerConcurrency: 1`. Runs FFmpeg with `-threads 2` under `nice -n 10`, plus whisper.cpp, Piper and Satori |
| `server/` | `marketing-postgres` (Docker) | Docker | `pgvector/pgvector:0.8.7-pg18`, named volume | 127.0.0.1:5436 | Databases `marketing` (app) and `marketing_dbos` (DBOS system DB) |
| (ops) | `marketing-otel` (Docker) | Docker | OpenObserve, named volume, retention set | 127.0.0.1:5080 (HTTP/OTLP), 127.0.0.1:5081 (gRPC) | Reached through an SSH tunnel only |

Both containers run from `/opt/marketing/docker-compose.yml`.

There is no Redis and there are no other containers. Memory use is not yet measured: budget roughly 2–3 GB resident in total and check it with `pm2 monit` and `docker stats` after the first deploy.

### Ports to request

Request 3040, 3041, 5436, 5080 and 5081. None of them is in the used list. Confirm on the box with `ss -ltnp | grep -E ':(3040|3041|5436|5080|5081)\b'`.

### nginx

One site, with server names to be decided:

- `/` goes to 3040.
- `/api/` goes to 3041.
- `/_next/static/` gets long cache headers.
- Use the shared `timed` log format.

Large media never passes through nginx because uploads go straight to R2 through presigned URLs. As always, run `nginx -t` before reloading; a broken file takes down every site on the box.

### Deploy

Each project deploys alone with the unchanged house command, because each folder is self-contained:

```
git archive HEAD:web    | ssh xenex /opt/marketing/bin/deploy web <sha>
git archive HEAD:server | ssh xenex /opt/marketing/bin/deploy server <sha>
```

| App | What the deploy script does |
|---|---|
| `web` | `pnpm install --frozen-lockfile`, `pnpm build` (standalone output), flip `current`, `pm2 reload marketing-web`, health-check 3040, roll back on failure |
| `server` | Build once, run `drizzle-kit migrate`, flip `current`, reload both `marketing-api` and `marketing-media` from that one release, health-check 3041, roll back on failure |

**Restarting the media worker:** a restart re-runs any in-flight render from its last completed DBOS step. Render steps must therefore write to deterministic R2 keys.

**Order of deploys:** when `openapi.json` changes, deploy `server` first.

**CI:** each project has its own CI job, triggered by changes under its folder. Both jobs run the same command as above through the house key pinned to `/opt/marketing/bin/deploy`.

Other house rules apply as usual:

- Logs go to `/var/log/marketing/<app>.{out,err}.log`.
- Secrets are listed in `/opt/marketing/secrets.env`, and new DB or app credentials go into both `inappcreds.txt` copies.
- Copies of every installed file live in `deploy/vps/`.

### What needs a GPU box instead

| Workload | Where it runs |
|---|---|
| Local LLM (T1) and bulk embedding of knowledge-base ingest (Ollama) | GPU box |
| Diffusion (ComfyUI) | GPU box |
| Long-form transcription | GPU box |
| FFmpeg templates, Satori statics, whisper.cpp on short clips, Piper | `marketing-media` on CPU |

The GPU box serves Ollama and ComfyUI over HTTPS with a bearer token, with its firewall allowing only 144.91.105.202. This needs no change on the shared VPS: no WireGuard, no new ufw rule, no new users.

If there is no GPU box, local-only tasks wait in a paused queue and raise an alert (§15.2: no silent fallback to hosted). Non-sensitive T1 tasks can be re-tiered to T2 or T3 by policy.

### Monthly cost ceiling notes

All figures are before model API usage.

| Item | Cost | NPR | Source |
|---|---|---|---|
| Shared VPS (existing) | no additional cost | 0 | n/a |
| Own VPS if headroom is short: Contabo Cloud VPS 8 | EUR 11.20 a month | ~1,950 | [Contabo](https://contabo.com/en/product-list/?show_ids=true) |
| R2, 100 GB stored | (100 − 10 free) × USD 0.015 = USD 1.35 | ~210 | [R2](https://developers.cloudflare.com/r2/pricing/) |
| R2, 1 TB stored | USD 14.85 | ~2,300 | same |
| GPU rent: Hetzner GEX45 (RTX PRO 4000 Blackwell, 24 GB) | EUR 214 a month, plus EUR 209 setup, excluding VAT | ~37,200 a month, plus ~36,300 once | [Hetzner](https://www.hetzner.com/dedicated-rootserver/matrix-gpu/) |
| Remotion Automators, if ever adopted | minimum USD 100 a month | ~15,500 | [Remotion](https://www.remotion.dev/docs/license/pricing) |

- **Pilot infrastructure:** stays under about NPR 2,500 a month without GPU rent.
- **GPU rent:** monthly rent does not pay off at pilot volume. A GEX45 alone needs about 124 videos a month at NPR 300 each just to cover its rent. Use an owner-supplied GPU or metered T3/T4 providers until volume proves otherwise.
- **Model API spend:** capped per brand in the cost ledger. The owner sets the ceiling (§24.1 decision 16).

## 4. What not to build (integrate instead)

This follows from the spec's scope-creep risk (§24): build orchestration, knowledge, cost and workflow advantage; integrate the rest.

| Do not build | Use instead |
|---|---|
| A job queue, scheduler or workflow server | DBOS |
| Login, sessions, MFA or invitations | Better Auth |
| Per-provider LLM SDKs, streaming or tool-calling plumbing | AI SDK |
| A separate vector database | pgvector |
| A video editor or timeline | Parameterised FFmpeg templates. Human edits happen in the editor of choice and come back as uploaded assets |
| A design tool | Brand templates in TSX through Satori. Designer work arrives as uploaded assets |
| A full multi-channel scheduler | Adapters for the 2–3 pilot channels only; add channels on demand (NFR-018) |
| A CRM, an email service, or WhatsApp business-service-provider plumbing | Integrate. Keep only the lead, consent, routing and suppression records |
| A CMS for brand sites | Create drafts through the brand CMS's API |
| A site crawler or SEO suite | Search Console and PageSpeed data through connectors, plus our own sitemap and broken-link check |
| An ad buying UI | Read, report and recommend only. Launches stay in the ad platform with human approval (§2.2) |
| A visual workflow designer | Workflows are code plus versioned JSON config; the Automation screen controls runs |
| Ops dashboards | OpenObserve. Product cost and KPI views are product features, not ops tooling |

## 5. Open questions for the owner

| # | Question | What it changes |
|---|---|---|
| 1 | Free RAM and disk on the shared box (devops to measure) | Shared box vs its own VPS (about NPR 1,950 a month) |
| 2 | Internal tool, agency service or SaaS (§24.1 decision 13), and xenextech headcount | AGPL/SSPL exposure; whether Remotion is free or needs the USD 100+ a month tier |
| 3 | Is a GPU machine available, and where (office behind NAT, or a data centre)? (decision 12) | Whether T1 exists at pilot; tunnel vs direct HTTPS; whether to rent a GEX45 |
| 4 | May brand data and media leave Nepal for US or EU providers (R2, hosted LLMs)? | R2 vs self-hosted SeaweedFS; which tasks may use T2 and T3 |
| 5 | Pilot language mix (Nepali and English) and first brand (decision 11) | Model, embedding and TTS voice shortlist for the Phase 0 benchmark |
| 6 | Pilot social channels and app credentials (decision 14) | Which 2–3 adapters Phase 3 builds; Meta app-review lead time |
| 7 | CRM, email and WhatsApp providers (decision 15) | Which ADR-008 adapters get built |
| 8 | Monthly infrastructure and model ceiling (decision 16) | Hard caps in the cost ledger; whether GPU rent is allowed |
| 9 | RPO and RTO (NFR-014) | Nightly dump (RPO 24 h) vs adding WAL archiving to R2 |
| 10 | What NPR 300 per video includes (decision 18) | Whether R2, compute, GPU rent and licence amortisation go into the per-asset cost |
| 11 | App and API hostnames | nginx site, certificates, cookie domain |

## What changed during the build

Where the built system differs from this document. The code and `docs/structure.md` are current.

| This document says | The built system | Why |
|---|---|---|
| Static images and carousels with Satori and resvg-js | `server/src/render/slide.ts` draws with `sharp` (libvips, Pango text) and bundled Noto Sans fonts; `video.ts` joins the frames with the FFmpeg CLI | Satori does not shape Devanagari, and Nepali copy must render correctly (Studio design, section 3). `sharp` was already installed |
| A second entrypoint `src/media.ts`, a `media` queue and a `marketing-media` pm2 process | One entrypoint, `src/main.ts`, one queue `default`, no media process. Renders run in the API process | A separate media worker was left out of the first build (Studio design, "Not in this sprint") |
| `src/render/` used by the media entrypoint only | `src/render/` is called by `domain/studio` inside the API process | Same |
| `src/connectors/` holding the connector contract and adapters | The contract and the `manual` and `mock` connectors are in `src/domain/publish/connectors/`; there are no platform adapters | The connector is Publish's own seam; real adapters wait for platform credentials (Publish design) |
| `src/domain/` holds brands, knowledge, content, approvals, publishing, crm, analytics, costs, audit | It holds `brands`, `sources`, `costs`, `audit`, `knowledge`, `research`, `plan`, `studio`, `approve`, `publish`, `home`. There is no `content`, `crm` or `analytics` | The modules were built in the order work flows (`docs/architecture.md`); Leads and Results are not built |
| `src/workflows/` holds WF-001 to WF-024 | One file per background run: `brand-import`, `research-watch`, `research-discovery`, `plan-draft`, `studio-run`, `publish-run` | Only the runs the built modules need exist |
| `src/` has `db`, `contracts`, `domain`, `workflows`, `ai`, `connectors`, `render` | Also `http/` (errors, router, brand-param schema), `storage/` (S3 client, object keys, presigned URLs), `search/` (the search gateway) and `text/` (text folds), plus `config.ts`, `modules.ts` and `log.ts` | Shared code that no module owns |
| No web search provider | Serper (Google web results and Maps listings, paid per query) behind `src/search/`, for competitor discovery. Queries carry the keywords the owner confirmed, never brand documents | Chosen in the competitor discovery design, section 4; it bears on open question 4 (data leaving Nepal) |
| Better Auth, with `brand_memberships` roles | Not installed. No login; one tenant from `TENANT_SLUG`, actor `operator` | The owner decided on no auth for the first build (Brand design) |
| OpenTelemetry to OpenObserve, `@ai-sdk/otel` | Not installed. Logs are pino to stdout | Not part of the first build |
| Whisper.cpp, Piper, Ollama, Nodemailer | Not installed | Not part of the first build; Studio leaves out voice and speech, Approve leaves out reminders (their designs) |
| pgvector for brand-filtered retrieval | The pgvector image is used in `docker-compose.dev.yml`, but no table has a vector column | No module needed retrieval |
| API on 127.0.0.1:3041, web on 3040 | Development defaults are API 8000 (`PORT`) and web 3000 (`web/playwright.config.ts`); production ports are set by `PORT` and `pnpm start -p` | Development only; production takes its port from `PORT` |
| `deploy/vps/` with copies of what is installed on the box | Not in the repository yet | No deployment has been made |
