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
  OPENROUTER_API_KEY: z.string().optional(),
  AI_MONTHLY_CAP_NPR: z.string().regex(/^\d+(\.\d+)?$/).default('5000'),
  // A research run estimated above this waits for the owner's confirmation.
  RESEARCH_RUN_CAP_NPR: z.string().regex(/^\d+(\.\d+)?$/).default('150'),
  USD_NPR: z.string().regex(/^\d+(\.\d+)?$/).default('155.08'),
  TENANT_SLUG: z.string().default('xenextech'),
  // pm2 sets it per cluster instance (0, 1, …); it names this process's DBOS executor (workflows/index.ts).
  NODE_APP_INSTANCE: z.string().regex(/^\d+$/).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

type Config = z.infer<typeof schema>;

/** The development defaults above, with the passwords of docker-compose.dev.yml: never a production value. */
const DEV_ONLY = ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'DBOS_SYSTEM_DATABASE_URL', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
const DEV_PASSWORDS = new Set(['', 'marketing', 'marketing_app', 'dev']);

/** Parses the environment. With NODE_ENV=production it refuses the development defaults, the mock model and a missing key. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const c = schema.parse(env);
  if (env.NODE_ENV !== 'production') return c;
  const unsafe: string[] = DEV_ONLY.filter((k) => !env[k] || DEV_PASSWORDS.has(env[k]!));
  for (const k of ['DATABASE_URL', 'DATABASE_ADMIN_URL', 'DBOS_SYSTEM_DATABASE_URL'] as const)
    if (env[k] && !unsafe.includes(k) && DEV_PASSWORDS.has(decodeURIComponent(URL.parse(env[k]!)?.password ?? ''))) unsafe.push(k);
  if (c.AI_MODEL === 'mock') unsafe.push('AI_MODEL');
  if (c.AI_MODEL.startsWith('anthropic:') && !c.ANTHROPIC_API_KEY) unsafe.push('ANTHROPIC_API_KEY');
  if (c.AI_MODEL.startsWith('openrouter:') && !c.OPENROUTER_API_KEY) unsafe.push('OPENROUTER_API_KEY');
  if (unsafe.length) throw new Error(`NODE_ENV=production: set ${unsafe.join(', ')} (unset, a development value, or a development password)`);
  return c;
}

export const config: Config = parseConfig(process.env);
