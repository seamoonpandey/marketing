// Controls for the e2e API's fixture server, which listens on API_PORT + 1000 (server/scripts/e2e-control.ts).
const API_PORT = Number(process.env.API_PORT ?? '8000');
const CONTROL = `http://127.0.0.1:${API_PORT + 1000}`;

async function call(method: string, path: string, body?: unknown): Promise<{ calls: number }> {
  const res = await fetch(`${CONTROL}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
  return res.json();
}

export const fixtureUrl = (path: string): string => `${CONTROL}${path.startsWith('/') ? path : `/${path}`}`;
export const setPage = async (path: string, html: string): Promise<void> => void (await call('PUT', '/__e2e/pages', { path, html }));
export const clearPages = async (): Promise<void> => void (await call('DELETE', '/__e2e/pages'));
export const queueAi = async (...objects: unknown[]): Promise<void> => void (await call('POST', '/__e2e/ai', { objects }));
export const resetAi = async (): Promise<void> => void (await call('DELETE', '/__e2e/ai'));
export const aiCalls = async (): Promise<number> => (await call('GET', '/__e2e/ai')).calls;
