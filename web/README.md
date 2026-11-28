# Prachaar web

Next.js (App Router). The landing page is `src/app/(marketing)/`; the product UI is `src/app/(app)/app/`, with its components in `src/components/<module>/` and the shared ones in `src/components/app/`. Read `AGENTS.md` first: this Next.js version differs from older ones.

```bash
pnpm install
pnpm dev                 # the web app; the API is proxied from API_PORT
pnpm build && pnpm start -p 3000
pnpm exec tsc --noEmit   # the type check (no lint is configured)
pnpm api:types           # regenerate src/lib/api/schema.d.ts from ../server/openapi.json
WEB_PORT=… API_PORT=… pnpm e2e                                   # the whole end-to-end suite
WEB_PORT=… API_PORT=… pnpm exec playwright test e2e/*.stub.spec.ts   # the stubbed ones, about a minute
```

The repository's `CLAUDE.md` and `docs/structure.md` describe the layout and the shared components.
