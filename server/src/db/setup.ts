import type pg from 'pg';

/** The role every policy names. The app connects as it; it has no BYPASSRLS. */
export const APP_ROLE = 'marketing_app';

/** Creates the app role if it is missing. Roles are cluster-wide, so parallel test files may race here. */
export async function ensureAppRole(admin: pg.ClientBase, password: string): Promise<void> {
  const pw = password.replaceAll("'", "''");
  await admin.query(`do $$ begin
    create role ${APP_ROLE} login nobypassrls password '${pw}';
  exception when duplicate_object or unique_violation then null;
  end $$`);
}

const GRANTS_SQL = `
grant usage on schema public to ${APP_ROLE};
grant select, insert, update, delete on all tables in schema public to ${APP_ROLE};
grant usage, select on all sequences in schema public to ${APP_ROLE};
revoke insert, update, delete, truncate on tenants from ${APP_ROLE};
revoke update, delete, truncate on audit_events from ${APP_ROLE};
`;

/**
 * Functions the app calls to read across brands without seeing their rows.
 * SECURITY DEFINER runs as the owner, which RLS does not restrict; each function filters by app.tenant_id.
 */
const FUNCTIONS_SQL = `
create or replace function tenant_month_cost_npr() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(cost_npr), 0) from cost_events
  where tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    and created_at >= date_trunc('month', now(), 'UTC')
$$;
revoke all on function tenant_month_cost_npr() from public;
grant execute on function tenant_month_cost_npr() to ${APP_ROLE};
`;

/** Everything Drizzle cannot express. Runs after every schema change. */
export const POST_SCHEMA_SQL = GRANTS_SQL + FUNCTIONS_SQL;
