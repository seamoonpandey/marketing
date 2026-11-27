import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_ADMIN_URL ?? 'postgres://marketing:marketing@127.0.0.1:5436/marketing' },
});
