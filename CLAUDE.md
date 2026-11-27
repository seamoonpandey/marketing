# CLAUDE.md

Product: Prachaar, the AI Marketing Operating System. `docs/AI_Marketing_Operating_System_specs.md` is the requirements baseline (SRS + FRS). Read the sections you touch before building. `docs/stack.md` is the chosen stack and why.

## Repo layout

One git repo of independent projects. Each top-level project has its own `package.json`, lockfile, build and deploy; nothing is shared through a workspace. Run commands inside the project folder.

- `web/`: Next.js 16 (App Router). The landing page is `src/app/(marketing)/` (its own root layout, prerendered static at `/`); the product UI will get its own route group. `pnpm dev`, `pnpm build`, `pnpm start -p 3040`. Read `web/AGENTS.md` first: this Next.js version differs from older ones.
- `server/` (planned, `docs/stack.md`): the API and its background workers. Web talks to it only through its OpenAPI contract.

## Brand

- Name: Prachaar (Nepali for publicity; the owner's choice). Buyer: brands in Nepal. Main action: "Join the pilot".
- Positioning: a marketing team that runs on AI, sold on better marketing, saved time and control, not on the technology.
- Mark: the ring (`web/public/favicon.svg`). Type: Geist and Geist Mono. Radius soft. Never violet.
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
