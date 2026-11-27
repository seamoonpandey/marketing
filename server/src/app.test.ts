import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

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
});
