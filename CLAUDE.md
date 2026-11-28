# CLAUDE.md

Product: Prachaar, the AI Marketing Operating System. `docs/AI_Marketing_Operating_System_specs.md` is the requirements baseline (SRS + FRS). Read the sections you touch before building. `docs/stack.md` is the chosen stack and why.

## Repo layout

One git repo of independent projects. Each top-level project has its own `package.json`, lockfile, build and deploy; nothing is shared through a workspace. Run commands inside the project folder. `docs/structure.md` is the layout and the shared contracts, `docs/architecture.md` is how the product works, `docs/status.md` is what is built, what is not, and what a deployment must set.

- `web/`: Next.js 16 (App Router). The landing page is `src/app/(marketing)/` (its own root layout, prerendered static at `/`). The product is `src/app/(app)/app/` (URL prefix `/app`, its own root layout), one folder per module under `b/[brandId]/`, with components in `src/components/<module>/` and the shared ones in `src/components/app/`. Read `web/AGENTS.md` first: this Next.js version differs from older ones.
- `server/`: the Hono API, its DBOS workflows and the render engine, on Postgres. Modules are in `src/domain/`: `brands`, `sources`, `costs`, `audit` (the base), `knowledge` (Brand), `research`, `plan`, `studio`, `approve`, `publish`, `home`. Web talks to it only through `server/openapi.json`.

## Run it locally

Node 24 or later, pnpm 12.11.2. Run `pnpm install` in `server/` and in `web/`.

| Step | Command (from the project folder) |
|---|---|
| Containers: Postgres (pgvector, 127.0.0.1:5436) and SeaweedFS (S3, 127.0.0.1:8333) | `docker compose -f docker-compose.dev.yml up -d` in `server/` (`colima start` first on a Mac) |
| Environment | `cp .env.example .env` in `server/`. The defaults match the containers and `AI_MODEL=mock`, which makes no paid call |
| Database | `pnpm db:reset` in `server/` drops and recreates the database in `DATABASE_URL` from the schema, with grants and the tenant. `pnpm db:migrate` then `pnpm seed` applies the committed migrations instead |
| API | `pnpm dev` in `server/`, port 8000 (`PORT`) |
| Web | `pnpm dev -p 3000` in `web/`. It proxies `/api` to `API_PORT` (default 8000) |
| Server tests | `pnpm test` in `server/`. Unit tests need nothing; `*.int.test.ts` need both containers and give every file its own database. `render.real.int.test.ts` and the video test also want `ffmpeg` on the PATH (the video test skips without it) |
| Server checks | `pnpm typecheck`, `pnpm openapi:check` |
| End to end | `pnpm e2e` in `web/`. It starts its own API (`server/scripts/e2e-server.ts`, database `mkt_e2e_<API_PORT>`, mock model) and `next dev` on `WEB_PORT` and `API_PORT` (3000 and 8000 by default), so stop your own dev servers or set other ports first. One worker. `pnpm exec playwright test e2e/*.stub.spec.ts` runs only the specs against a stubbed API, about a minute (`web/README.md`). The full suite's time has not been recorded |
| Web checks | `pnpm exec tsc --noEmit`, `pnpm build` |

Tests never call a paid model: `vitest.config.ts` forces `AI_MODEL=mock`.

## Rules the code cannot show

- **Brand data:** every query on a brand-owned table runs inside `withBrand(brandId, tx => …)` (`server/src/db/tenant.ts`). Row-level security reads the setting it makes; outside it you see no rows. Every brand-owned table declares `brandPolicies`.
- **Module boundaries:** read another module only through its `index.ts`. Approve, Publish and Home each have one place for what they read from another module (`approve/studio.ts`, `publish/reads.ts`, Home's `readers`).
- **Models:** every model call goes through `extract` in `server/src/ai`. It checks the monthly cap, prices, records the cost and gives the model no tools. Never import an AI SDK or call a provider elsewhere.
- **Publishing:** anything that publishes calls `validApproval` (`domain/approve`) and sends nothing without an approval. Never retry a send whose outcome is unknown.
- **Facts:** use `approvedFacts`, never the facts table, to read what a brand has approved. A fact needs a source and a quote that `verifyQuote` finds in the source.
- **Migrations are generated:** change `server/src/db/schema/`, then `pnpm db:generate`. Never write or edit a migration by hand. Grants and functions Drizzle cannot express go in `server/src/db/setup.ts`. Do not use `drizzle-kit push`: it drops RLS clauses.
- **Generated files are regenerated, never merged:** `server/openapi.json` (`pnpm openapi`), `web/src/lib/api/schema.d.ts` (`pnpm api:types`) and both `pnpm-lock.yaml`. After a merge or rebase, regenerate them.
- **A new module** registers itself in `server/src/modules.ts`, `server/src/db/schema/index.ts`, `web/src/nav.ts` and `web/src/app/(app)/app.css` (`@source`). See `docs/structure.md`. Every new route also needs an entry in `server/src/isolation.int.test.ts`, which fails for a route it does not know.
- **Text:** compare text that came from a model, a web page or a person through `server/src/text/normalise.ts` (`foldText`, `plainText`, `stripInvisible`, `asciiDigits`), never with a bare `===`. Invisible characters, look-alike letters and digits of other scripts have each been used to slip past a check. Two deliberate exceptions: quote matching does not fold look-alikes or digits, so a quote that reads differently from its source cannot pass, and slugs are left as written.
- **Workflow executors:** two API processes must never share a DBOS executor ID. Under pm2 cluster mode `NODE_APP_INSTANCE` gives each its own.
- **Tests:** `*.test.ts` beside the code; Postgres or storage means `*.int.test.ts`. Never import `drizzle-kit/api` in a test file (it breaks pdf.js); the schema SQL comes from `server/test/global-setup.ts`.

## Brand

- Name: Prachaar (Nepali for publicity; the owner's choice). Buyer: brands in Nepal. Main action: "Join the pilot".
- Positioning: a marketing team that runs on AI, sold on better marketing, saved time and control, not on the technology.
- Logo and mascot: the owner's artwork is the source, `web/public/brand/prachaar-logo-master.png` (the mascot, a robot in a dhaka topi with a megaphone, beside the wordmark whose P is a speech bubble with a play triangle) and `prachaar-mascot-master.png` (the mascot alone): a flat illustration with soft 3D shading. Never redraw or recolour it; the web copies are trimmed and resized from the masters.
- Mascot poses, in `web/public/brand/mascot/`: the owner's artwork, one `<pose>-master.jpg` each on white (wave, celebrate, point, think-left, think-right, head). `web/scripts/mascot-assets.py` (Pillow; run from `web/` after adding or changing a master) cuts the white away and writes `<pose>.webp` (640 wide) and `<pose>-small.webp` (280 wide), the mirrored `wave-left` (its chest P put back the right way round, `FLIPS`) and the favicons from `head`. The mascot always faces the content beside it, and no pose shows twice on a screen. On the page: hero wave-left (right of the headline), statement celebrate (left of it), questions think-right (think-left under 1024px), pilot form point.
- On the site use `web/src/components/brand.tsx`: `Lockup` (nav, the right end of the footer's bottom bar), `Mascot art=... narrow=...` and `Mark` (the vector P, the nav under 400px). The favicon is the head pose on transparent (`web/public/brand/favicon-32.png`, `favicon-64.png`); the touch icon (`apple-touch-icon.png`) is the head on white, since iOS needs an opaque icon.
- Type: Geist and Geist Mono. Radius soft. Never violet.
- Copy: plain, category first, no invented proof, prices only from the brief.

## Colour and themes

`web/public/theme.css` is the only place colours are defined: the palette (`--pal-*`), the themes (`--theme-*`, one `[data-theme]` block each) and the bridges to the kit (`--p-*`) and to Tailwind (`src/app/(marketing)/islands.css`: `bg-action`, `text-ink`, `from-highlight`; its zinc, red and other stock hues are mapped to the theme too). Components use `--theme-*` or those Tailwind names, never a hex. The contrast rules every theme keeps are written at the top of `theme.css`.

- The site wears the theme named in `web/src/theme.ts` (`THEME`, default `pastel`); that one word switches the colours, the kit's lit ground and the browser theme-color.
- `pastel` (default): mist `#c3d7e5` ground, `#d0e0eb` surface, ink `#141414`, slate `#4a5068` for labels, teal `#0f5257` for the brand, buttons and links, sky `#5f93cc` as decoration, the dark band `#141414` with mist ink and a mist action.
- `heritage`: porcelain `#f5efe5` ground, espresso `#24201d` ink, terracotta `#b94e2f` brand, `#ab482b` for buttons and links, champagne `#c6a46a` as decoration and the dark band's action, olive for success, raspberry `#9f1239` for errors.
- `vermilion`: ivory, charcoal, vermilion `#e85d27` brand, `#c24515` for buttons and links, marigold decoration.
- Add a theme: one `[data-theme="<name>"]` block of every `--theme-*` token in `theme.css`, an entry in `web/src/theme.ts`, check its contrast pairs, and capture its hero still into `web/public/themes/<name>/hero.jpg` (the Aurora alone on the theme's ground, 1280x420).
- Nepali text: none of the current faces carry Devanagari; add a Devanagari face (for example Noto Sans Devanagari) to the font stacks before the product shows Nepali copy.

## The landing page

Built with the taste skill's kit, copied to `web/public/assets` (unused families removed). Page CSS lives in `web/public/landing.css`, Tailwind for the React islands in `src/app/(marketing)/islands.css`, and the islands in `src/components/`. The finish gate runs against the built page: `pnpm build && pnpm start -p 3000`, then from `web/`: `node ../.claude/skills/design-taste-frontend/scripts/gate.mjs http://127.0.0.1:3000/` (the other checks are in the skill's SKILL.md, section 4).

## Design and landing pages

Use the project skills in `.claude/skills/` for any UI, landing page or marketing site work:

- `design-taste-frontend` (Leonxlnx/taste-skill): builds and gate-checks the page. Run its gate before calling a page done.
- `impeccable` (pbakaus/impeccable): critique, audit, polish. Its hooks live in `.claude/settings.local.json`; run `/impeccable init` once to set design context.
- Emil Kowalski's skills (emilkowalski/skills): `animate`, `choreograph`, `review-animations`, `emil-design-eng`, `animation-performance`, `mobile-native`, `break-ui`, `pick-ui-library`.

Skill versions are pinned in `skills-lock.json`. Update with `npx skills update -p` and `npx impeccable install --project --providers=claude --force`.

## Component and motion sources

Reach for these before writing a component or animation by hand. All three UI sources are shadcn registries, so the code is copied into the repo and owned here. Add them to `components.json`:

```json
"registries": {
  "@react-bits": "https://reactbits.dev/r/{name}.json",
  "@kokonutui": "https://kokonutui.com/r/{name}.json",
  "@watermelon": "https://registry.watermelon.sh/r/{name}.json"
}
```

- React Bits (reactbits.dev): text effects, backgrounds, animated blocks. `npx shadcn@latest add @react-bits/SplitText-TS-TW` (suffix: `TS`, `TW`).
- Kokonut UI (kokonutui.com): Tailwind + Motion components. `npx shadcn@latest add @kokonutui/<name>`.
- Watermelon UI (ui.watermelon.sh): animated components. `npx shadcn@latest add @watermelon/<name>`.
- anime.js v4 (animejs.com): timelines and staggers outside React components. `npm i animejs`, then `import { animate, stagger, createTimeline } from 'animejs'`.

Respect `prefers-reduced-motion` in every animation.
