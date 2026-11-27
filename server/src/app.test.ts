import { describe, expect, it } from 'vitest';
import { createApp, MAX_BODY_BYTES } from './app.ts';

describe('app', () => {
  it('answers GET /api/health', async () => {
    const res = await createApp().request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers an unknown path with the error body', async () => {
    const res = await createApp().request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });

  it('refuses a body over 1 MB with 413 before any route reads it, and sends the security headers', async () => {
    const big = JSON.stringify({ name: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await createApp().request('/api/brands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: { code: 'too_large', message: expect.any(String) } });
    const health = await createApp().request('/api/health');
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });
});
