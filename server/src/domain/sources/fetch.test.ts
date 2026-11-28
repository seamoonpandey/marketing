import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchGuard, fetchPage } from './fetch.ts';
import { pickPages } from './pick-pages.ts';

const fixture = (name: string) => readFileSync(new URL(`../../../test/fixtures/base/site/${name}`, import.meta.url), 'utf8');

let server: Server;
let port: number;
const defaults = { ...fetchGuard };
const site = (host: string, path = '/') => `http://${host}:${port}${path}`;

// One local server plays several "public" sites, told apart by the Host header.
beforeAll(async () => {
  server = createServer((req, res) => {
    const host = req.headers.host!.split(':')[0];
    const origin = `http://${req.headers.host}`;
    const html = (body: string) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    const url = req.url!;
    if (url === '/robots.txt') {
      const rules: Record<string, string> = {
        'site.test': 'User-agent: *\nDisallow: /private\n',
        'bots.test': 'User-agent: OtherBot\nDisallow: /\n\nUser-agent: PrachaarBot\nDisallow: /no-bots\n',
      };
      if (rules[host!]) return res.writeHead(200, { 'content-type': 'text/plain' }).end(rules[host!]);
      return res.writeHead(404).end();
    }
    if (host === 'bare.test') return url === '/' ? html(fixture('bare.html')) : res.writeHead(404).end();
    if (url === '/') return html(fixture('home.html'));
    if (url === '/sitemap.xml')
      return res.writeHead(200, { 'content-type': 'application/xml' }).end(fixture('sitemap.xml').replaceAll('{{origin}}', origin));
    if (url === '/nepali') return html(fixture('nepali.html'));
    if (url === '/to-private') return res.writeHead(302, { location: 'http://10.0.0.5/' }).end();
    if (url.startsWith('/hop/')) {
      const n = Number(url.slice(5));
      return n === 0 ? html('<title>Landed</title>') : res.writeHead(302, { location: `/hop/${n - 1}` }).end();
    }
    if (url === '/big') return html(`<p>${'x'.repeat(3 * 1024 * 1024)}</p>`);
    if (url === '/doc') return res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4');
    if (url === '/private' || url === '/no-bots') return html('<title>secret</title>');
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => Object.assign(fetchGuard, defaults));

/** Lets *.test names resolve to the local server, which counts as public; every other private address stays blocked. */
function localSites() {
  fetchGuard.resolve = async (host) =>
    host.endsWith('.test') ? [{ address: '127.0.0.1', family: 4 }] : defaults.resolve(host);
  fetchGuard.isBlocked = (ip) => ip !== '127.0.0.1' && defaults.isBlocked(ip);
  fetchGuard.minIntervalMs = 0;
}

describe('fetchPage guards', () => {
  it('lets public addresses through and blocks private ones, IPv4-mapped forms included', () => {
    for (const ip of ['8.8.8.8', '104.21.68.244', '172.67.200.73', '2606:4700:3033::6815:44f4']) expect(defaults.isBlocked(ip), ip).toBe(false);
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fc00::1', 'fe80::1',
      '::ffff:127.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::'])
      expect(defaults.isBlocked(ip), ip).toBe(true);
  });

  it.each([
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'file:///etc/passwd',
    'ftp://example.com/',
  ])('refuses %s', async (url) => {
    await expect(fetchPage(url)).rejects.toThrow();
  });

  it('refuses a hostname that resolves to a private address', async () => {
    fetchGuard.minIntervalMs = 0;
    await expect(fetchPage(`http://localhost:${port}/`)).rejects.toThrow(/private|blocked/i);
  });

  it('refuses a public URL that redirects to a private one', async () => {
    localSites();
    await expect(fetchPage(site('site.test', '/to-private'))).rejects.toThrow(/private|blocked/i);
  });

  it('follows five redirects and refuses a sixth', async () => {
    localSites();
    expect((await fetchPage(site('site.test', '/hop/5'))).title).toBe('Landed');
    await expect(fetchPage(site('site.test', '/hop/6'))).rejects.toThrow(/redirect/i);
  });

  it('refuses a body over 2 MB and a page that is not HTML', async () => {
    localSites();
    await expect(fetchPage(site('site.test', '/big'))).rejects.toThrow(/2 MB|too large/i);
    await expect(fetchPage(site('site.test', '/doc'))).rejects.toThrow(/content type/i);
  });

  it('respects robots.txt for PrachaarBot and for *', async () => {
    localSites();
    await expect(fetchPage(site('site.test', '/private'))).rejects.toThrow(/robots/i);
    await expect(fetchPage(site('bots.test', '/no-bots'))).rejects.toThrow(/robots/i);
    expect((await fetchPage(site('bots.test', '/private'))).title).toBe('secret');
  });

  it('returns the final URL, HTML, text and title', async () => {
    localSites();
    const page = await fetchPage(site('site.test', '/hop/1'));
    expect(page).toMatchObject({ finalUrl: site('site.test', '/hop/0'), title: 'Landed' });
  });

  it('waits a second between requests to one host', async () => {
    localSites();
    fetchGuard.minIntervalMs = 1000;
    const start = Date.now();
    await fetchPage(site('bare.test'));
    await fetchPage(site('bare.test'));
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
  });
});

describe('pickPages', () => {
  it('returns at most max same-site URLs, homepage first, preferred paths next', async () => {
    localSites();
    const pages = await pickPages(site('site.test'), 10);
    expect(pages).toHaveLength(10);
    expect(pages[0]).toBe(site('site.test'));
    for (const p of pages) expect(new URL(p).hostname).toBe('site.test');
    const preferred = pages.slice(1, 9).map((p) => new URL(p).pathname);
    expect(new Set(preferred)).toEqual(
      new Set(['/pricing', '/contact', '/about-us', '/products/green-tea', '/services/wholesale', '/terms', '/refund-policy', '/faq']),
    );
    expect(pages).not.toContain(site('site.test', '/brochure.pdf'));
    expect(pages.some((p) => p.includes('#'))).toBe(false);
  });

  it('returns the homepage alone for a site with no sitemap and no links', async () => {
    localSites();
    expect(await pickPages(site('bare.test'), 10)).toEqual([site('bare.test')]);
  });
});
