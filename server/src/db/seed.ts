import pg from 'pg';
import { config } from '../config.ts';

/** Inserts the one tenant the app runs as (TENANT_SLUG) and returns its ID. Needs the owner role. */
export async function seedTenant(admin: pg.ClientBase, slug = config.TENANT_SLUG): Promise<string> {
  const r = await admin.query<{ id: string }>(
    `insert into tenants (name, slug) values ($1, $2)
     on conflict (slug) do update set slug = excluded.slug returning id`,
    [slug === 'xenextech' ? 'Xenextech' : slug, slug],
  );
  return r.rows[0]!.id;
}

if (import.meta.main) {
  const admin = new pg.Client(config.DATABASE_ADMIN_URL);
  await admin.connect();
  console.log(`tenant ${config.TENANT_SLUG}: ${await seedTenant(admin)}`);
  await admin.end();
}
