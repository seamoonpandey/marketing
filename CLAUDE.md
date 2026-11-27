# CLAUDE.md

Product: Pracharo, the AI Marketing Operating System. `AI_Marketing_Operating_System_specs.md` is the requirements baseline (SRS + FRS). Read the sections you touch before building. `docs/stack.md` is the chosen stack and why.

## Repo layout

One git repo of independent projects. Each top-level project has its own `package.json`, lockfile, build and deploy; nothing is shared through a workspace. Run commands inside the project folder.

- `web/`: Next.js 16 (App Router). The landing page is `src/app/(marketing)/` (its own root layout, prerendered static at `/`); the product UI will get its own route group. `pnpm dev`, `pnpm build`, `pnpm start -p 3040`. Read `web/AGENTS.md` first: this Next.js version differs from older ones.
- `server/` (planned, `docs/stack.md`): the API and its background workers. Web talks to it only through its OpenAPI contract.

## Brand

- Name: Pracharo (coined from *prachar*, Nepali for publicity). Buyer: brands in Nepal. Main action: "Join the pilot".
- Mark: the ring (`web/public/favicon.svg`). Palette: ground `#c3d7e5`, surface `#d0e0eb`, ink `#141414`, muted `#4a5068`, accent `#0f5257`; dark band `#141414` with `#c3d7e5` ink. Type: Geist and Geist Mono. Radius soft. Never violet.
- Copy: plain, category first, no invented proof, prices only from the brief.

## The landing page

Built with the taste skill's kit, copied to `web/public/assets` (unused families removed). Page CSS lives in `web/public/landing.css`, Tailwind for the React islands in `src/app/(marketing)/islands.css`, and the islands in `src/components/`. The finish gate runs against the built page: `pnpm build && pnpm start -p 3040`, then from `web/`: `node ../.claude/skills/design-taste-frontend/scripts/gate.mjs http://127.0.0.1:3040/` (the other checks are in the skill's SKILL.md, section 4).

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
