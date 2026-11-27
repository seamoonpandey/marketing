import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { fetchGuard, fetchPage } from '../src/domain/sources/fetch.ts';
import { allowFixtureHost, startControlServer } from './e2e-control.ts';

describe('production app', () => {
  it('has no e2e control routes', async () => {
    for (const path of ['/__e2e/ai', '/__e2e/pages', '/api/__e2e/ai'])
      expect((await createApp().request(path)).status).toBe(404);
  });
});

describe('e2e control server', () => {
  let server: http.Server;
  let origin: string;
  const saved = { ...fetchGuard };
  beforeAll(async () => {
    server = await startControlServer(0);
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    allowFixtureHost();
  });
  afterAll(() => {
    Object.assign(fetchGuard, saved);
    server.close();
  });

  it('serves a fixture page to the guarded fetcher, and keeps other addresses blocked', async () => {
    await fetch(`${origin}/__e2e/pages`, { method: 'PUT', body: JSON.stringify({ path: '/a', html: '<title>Hi</title><p>Hello</p>' }) });
    const page = await fetchPage(`${origin}/a`);
    expect(page.title).toBe('Hi');
    expect(fetchGuard.minIntervalMs).toBe(0);
    for (const ip of ['10.0.0.1', '192.168.1.1', '169.254.169.254', '::1']) expect(fetchGuard.isBlocked(ip)).toBe(true);
    await expect(fetchPage('http://10.0.0.1/')).rejects.toMatchObject({ kind: 'blocked' });
  });

  it('counts and resets mock model calls', async () => {
    const post = (method: string, body?: unknown) =>
      fetch(`${origin}/__e2e/ai`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }).then((r) => r.json());
    expect(await post('POST', { objects: [{ a: 1 }] })).toEqual({ calls: 0 });
    expect(await post('DELETE')).toEqual({ calls: 0 });
  });
});
