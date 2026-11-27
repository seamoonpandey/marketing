// The API for the web's Playwright tests: recreates database mkt_e2e_<PORT> with the current schema,
// then starts src/main.ts on PORT. One database per port, so several worktrees can run their e2e at once.
import { spawnSync } from 'node:child_process';

// It drops and recreates a database, answers from the mock model and lets the fetcher reach 127.0.0.1.
if (process.env.NODE_ENV === 'production') throw new Error('The e2e harness never runs with NODE_ENV=production');

const port = process.env.PORT ?? '3141';
const name = `mkt_e2e_${port}`;
const admin = process.env.DATABASE_ADMIN_URL ?? 'postgres://marketing:marketing@127.0.0.1:5436/marketing';
const app = process.env.DATABASE_URL ?? 'postgres://marketing_app:marketing_app@127.0.0.1:5436/marketing';
const inDb = (url: string) => Object.assign(new URL(url), { pathname: `/${name}` }).toString();

// In its own process: drizzle-kit/api patches Array and String prototypes, which breaks pdf.js.
const reset = spawnSync('node', ['scripts/db-reset.ts', name], {
  stdio: 'inherit',
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, DATABASE_ADMIN_URL: admin, DATABASE_URL: app },
});
if (reset.status !== 0) process.exit(reset.status ?? 1);

Object.assign(process.env, {
  PORT: port,
  AI_MODEL: 'mock',
  DATABASE_ADMIN_URL: inDb(admin),
  DATABASE_URL: inDb(app),
  DBOS_SYSTEM_DATABASE_URL: inDb(admin),
});
await import('../src/main.ts');

// Fixture pages and AI controls on PORT + 1000, and the fetcher allowed to reach them.
const { allowFixtureHost, startControlServer } = await import('./e2e-control.ts');
allowFixtureHost();
await startControlServer(Number(port) + 1000);
