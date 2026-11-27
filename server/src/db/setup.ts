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

/** Grants and functions that Drizzle cannot express. Runs after every schema change. */
export const POST_SCHEMA_SQL = `
grant usage on schema public to ${APP_ROLE};
grant select, insert, update, delete on all tables in schema public to ${APP_ROLE};
grant usage, select on all sequences in schema public to ${APP_ROLE};
revoke insert, update, delete, truncate on tenants from ${APP_ROLE};
`;
