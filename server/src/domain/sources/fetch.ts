import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import robotsParser from 'robots-parser';
import { ValidationError } from '../../http/errors.ts';
import { htmlText, htmlTitle } from './html-text.ts';

const USER_AGENT = 'PrachaarBot/0.1';
const MAX_REDIRECTS = 5;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

export class FetchError extends ValidationError {
  readonly kind: 'protocol' | 'blocked' | 'robots' | 'redirects' | 'too_large' | 'type' | 'status' | 'timeout';
  constructor(kind: FetchError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

// Private, loopback, link-local (cloud metadata), shared, documentation, multicast and reserved
// ranges, plus IPv6 forms that can carry an IPv4 address (NAT64, 6to4, Teredo). IPv4-mapped
// addresses (::ffff:a.b.c.d) are checked against the IPv4 ranges by BlockList itself; listing
// ::ffff:0:0/96 would block every IPv4 address, since BlockList matches IPv4 against that rule too.
const reserved = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) reserved.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) reserved.addSubnet(net, bits, 'ipv6');

/** The fetcher's resolver, address check and per-host interval. Tests swap them to treat a local server as public. */
export const fetchGuard = {
  resolve: (host: string): Promise<{ address: string; family: number }[]> => lookup(host, { all: true }),
  isBlocked: (ip: string): boolean => reserved.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4'),
  minIntervalMs: 1000,
};

// Called by every connection, so the address checked is the address connected to (no DNS rebinding).
const guardedLookup = ((hostname: string, options: { all?: boolean }, callback: (...a: unknown[]) => void) => {
  fetchGuard.resolve(hostname).then(
    (addresses) => {
      if (!addresses.length || addresses.some((a) => fetchGuard.isBlocked(a.address)))
        return callback(new FetchError('blocked', `${hostname} resolves to a private or reserved address`));
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0]!.address, addresses[0]!.family);
    },
    (err) => callback(err),
  );
}) as unknown as LookupFunction;

function checkTarget(url: URL): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new FetchError('protocol', `Only http and https URLs can be fetched, not ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && fetchGuard.isBlocked(host))
    throw new FetchError('blocked', `${host} is a private or reserved address`);
}

// shortcut: per-process memory, so several API processes each keep their own pace; move to a
// DBOS queue rate limit when fetching runs on more than one process.
const nextSlot = new Map<string, number>();
async function politeWait(host: string): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + fetchGuard.minIntervalMs);
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

type Answer = { status: number; location?: string; type: string; charset?: string; body: Uint8Array };

function requestOnce(url: URL, signal: AbortSignal, accept: string[] | null): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? https.get : http.get;
    const req = get(
      url,
      { agent: false, lookup: guardedLookup, signal, headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.5' } },
      (res) => {
        const status = res.statusCode ?? 0;
        const [type = '', ...params] = (res.headers['content-type'] ?? '').split(';').map((s) => s.trim().toLowerCase());
        const charset = params.find((p) => p.startsWith('charset='))?.slice(8).replace(/"/g, '');
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, type, body: new Uint8Array() });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, type, body: new Uint8Array() });
        }
        if (accept && !accept.includes(type)) {
          res.destroy();
          return reject(new FetchError('type', `Refused content type "${type || 'none'}" at ${url.href}`));
        }
        const tooLarge = () => new FetchError('too_large', `${url.href} is larger than 2 MB`);
        if (Number(res.headers['content-length']) > MAX_BYTES) {
          res.destroy();
          return reject(tooLarge());
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(tooLarge());
          } else chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, type, charset, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

/** GET with every guard: scheme, address at connect time, robots, pace, redirects, size, type, time. */
async function guardedGet(input: string, accept: string[] | null, obeyRobots: boolean) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError('protocol', `Not a URL: ${input}`);
  }
  for (let hop = 0; ; hop++) {
    checkTarget(url);
    if (obeyRobots && !(await robotsAllow(url))) throw new FetchError('robots', `robots.txt disallows ${url.href}`);
    await politeWait(url.host);
    const answer = await requestOnce(url, signal, accept).catch((e) => {
      throw signal.aborted ? new FetchError('timeout', `${url.href} took longer than 10 seconds`) : e;
    });
    if (!answer.location) return { url, ...answer };
    if (hop >= MAX_REDIRECTS) throw new FetchError('redirects', `More than ${MAX_REDIRECTS} redirects from ${input}`);
    url = new URL(answer.location, url);
  }
}

function decode(body: Uint8Array, charset?: string): string {
  try {
    return new TextDecoder(charset || 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body); // unknown charset label
  }
}

// shortcut: robots.txt is cached per process for an hour; enough for one import run.
const robotsCache = new Map<string, { at: number; robots: ReturnType<typeof robotsParser> }>();

async function robotsFor(url: URL) {
  const cached = robotsCache.get(url.origin);
  if (cached && Date.now() - cached.at < 3_600_000) return cached.robots;
  const robotsUrl = `${url.origin}/robots.txt`;
  const answer = await guardedGet(robotsUrl, null, false);
  // RFC 9309: 4xx means no rules; 5xx means the whole site is off limits.
  const body =
    answer.status >= 200 && answer.status < 300 ? decode(answer.body, answer.charset)
    : answer.status >= 500 ? 'User-agent: *\nDisallow: /\n'
    : '';
  const robots = robotsParser(robotsUrl, body);
  robotsCache.set(url.origin, { at: Date.now(), robots });
  return robots;
}

async function robotsAllow(url: URL): Promise<boolean> {
  return (await robotsFor(url)).isAllowed(url.href, 'PrachaarBot') !== false;
}

/** The sitemaps a site's robots.txt lists. */
export async function robotsSitemaps(siteUrl: string): Promise<string[]> {
  return (await robotsFor(new URL(siteUrl))).getSitemaps();
}

/** A non-HTML resource (a sitemap) under the same guards; robots.txt is not consulted. */
export async function fetchText(url: string): Promise<string> {
  const answer = await guardedGet(url, null, false);
  if (answer.status < 200 || answer.status >= 300) throw new FetchError('status', `${url} answered ${answer.status}`);
  return decode(answer.body, answer.charset);
}

/** Any file (a logo) under the same guards and robots.txt. The caller checks what the bytes are. */
export async function fetchFile(url: string): Promise<{ finalUrl: string; body: Uint8Array }> {
  const answer = await guardedGet(url, null, true);
  if (answer.status < 200 || answer.status >= 300) throw new FetchError('status', `${url} answered ${answer.status}`);
  return { finalUrl: answer.url.href, body: answer.body };
}

/**
 * Fetches one HTML page under the guards: http(s) only; no private, loopback, link-local or metadata
 * address, checked at connect time and after every redirect; at most 5 redirects; 2 MB; 10 seconds;
 * text/html or application/xhtml+xml; robots.txt for PrachaarBot; one request per second per host.
 */
export async function fetchPage(url: string): Promise<{ finalUrl: string; html: string; text: string; title: string }> {
  const answer = await guardedGet(url, HTML_TYPES, true);
  if (answer.status < 200 || answer.status >= 300) throw new FetchError('status', `${url} answered ${answer.status}`);
  const html = decode(answer.body, answer.charset);
  return { finalUrl: answer.url.href, html, text: htmlText(html), title: htmlTitle(html) };
}
