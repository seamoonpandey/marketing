import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().default(3141),
  DATABASE_URL: z.string().default('postgres://marketing_app:marketing_app@127.0.0.1:5436/marketing'),
  DATABASE_ADMIN_URL: z.string().default('postgres://marketing:marketing@127.0.0.1:5436/marketing'),
  DBOS_SYSTEM_DATABASE_URL: z.string().default('postgres://marketing:marketing@127.0.0.1:5436/marketing_dbos'),
  S3_ENDPOINT: z.string().default('http://127.0.0.1:8333'),
  S3_BUCKET: z.string().default('marketing-dev'),
  S3_ACCESS_KEY_ID: z.string().default('dev'),
  S3_SECRET_ACCESS_KEY: z.string().default('dev'),
  AI_MODEL: z.string().default('anthropic:claude-opus-5-5'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MONTHLY_CAP_NPR: z.string().regex(/^\d+(\.\d+)?$/).default('5000'),
  USD_NPR: z.string().regex(/^\d+(\.\d+)?$/).default('155.08'),
  TENANT_SLUG: z.string().default('xenextech'),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
