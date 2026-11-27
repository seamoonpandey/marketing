import { defineConfig } from 'vitest/config';

// Local defaults that match docker-compose.dev.yml; the environment overrides them.
const env = {
  AI_MODEL: 'mock',
  DATABASE_URL: 'postgres://marketing_app:marketing_app@127.0.0.1:5436/marketing',
  DATABASE_ADMIN_URL: 'postgres://marketing:marketing@127.0.0.1:5436/marketing',
  DBOS_SYSTEM_DATABASE_URL: 'postgres://marketing:marketing@127.0.0.1:5436/marketing_dbos',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_BUCKET: 'marketing-dev',
  S3_ACCESS_KEY_ID: 'dev',
  S3_SECRET_ACCESS_KEY: 'dev',
  ...process.env,
};
env.AI_MODEL = 'mock'; // tests never make a paid model call

export default defineConfig({
  test: {
    env,
    globalSetup: ['test/global-setup.ts'],
    // Every worktree's suite and e2e server share one Postgres of 100 connections (docker-compose.dev.yml). Four files
    // at a time, each with pools of 4 (test/helpers.ts), keep one suite near 30 connections, so two suites and an e2e
    // server fit; at the default worker count one suite used up to 80 and concurrent runs failed with 53300.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
