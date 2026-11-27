// Test controls for the e2e API process: a fixture-page server with an AI queue, and the one fetch-guard exception.
import http from 'node:http';
import { mockAi } from '../src/ai/mock.ts';
import { fetchGuard } from '../src/domain/sources/fetch.ts';

/** Lets the fetcher reach 127.0.0.1 (every other address stays blocked) and drops the per-host delay. */
// shortcut: the guard checks addresses, not ports, so every port on 127.0.0.1 opens; fine for a throwaway e2e process.
export function allowFixtureHost(): void {
  const blocked = fetchGuard.isBlocked;
  fetchGuard.isBlocked = (ip) => ip !== '127.0.0.1' && blocked(ip);
  fetchGuard.minIntervalMs = 0;
}

const ALLOW_ALL = 'User-agent: *\nAllow: /\n';

export function startControlServer(port: number): Promise<http.Server> {
  const pages = new Map<string, string>();
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    try {
      let body: any = {};
      if (req.method === 'PUT' || req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      }
      if (path === '/__e2e/pages') {
        if (req.method === 'PUT') pages.set(body.path.startsWith('/') ? body.path : `/${body.path}`, body.html);
        else if (req.method === 'DELETE') pages.clear();
        else return send(405, { error: 'method' });
        return send(200, { ok: true });
      }
      if (path === '/__e2e/ai') {
        if (req.method === 'POST') mockAi.queue(...body.objects);
        else if (req.method === 'DELETE') mockAi.reset();
        else if (req.method !== 'GET') return send(405, { error: 'method' });
        return send(200, { calls: mockAi.calls.length });
      }
      if (req.method === 'GET' && pages.has(path)) return send(200, pages.get(path)!, 'text/html; charset=utf-8');
      if (req.method === 'GET' && path === '/robots.txt') return send(200, ALLOW_ALL, 'text/plain');
      send(404, 'not found', 'text/plain');
    } catch (e) {
      send(400, { error: String(e) });
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
