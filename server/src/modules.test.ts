import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../test/helpers.ts';
import { createApp } from './app.ts';
import { withBrand } from './db/tenant.ts';
import { approvedFacts } from './domain/knowledge/index.ts';
import { moduleRoutes } from './modules.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

describe('module stubs', () => {
  it('mounts every module router and the app starts', async () => {
    expect(moduleRoutes.length).toBeGreaterThan(0);
    for (const r of moduleRoutes) expect(r).toBeInstanceOf(OpenAPIHono);
    expect((await createApp().request('/api/health')).status).toBe(200);
  });

  it('approvedFacts returns [] until the brand branch fills it', async () => {
    const brand = await t.makeBrand();
    expect(await withBrand(brand, (tx) => approvedFacts(tx, brand))).toEqual([]);
    expect(await withBrand(brand, (tx) => approvedFacts(tx, brand, { section: 'identity' }))).toEqual([]);
  });
});
