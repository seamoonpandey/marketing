import { parse } from 'node-html-parser';
import { fetchPage, fetchText, robotsSitemaps } from './fetch.ts';

const PREFERRED = ['about', 'product', 'service', 'pricing', 'contact', 'faq', 'terms', 'refund'];
const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|ico|zip|docx?|xlsx?|pptx?|csv|mp[34]|mov|css|js|json|xml|txt)$/i;

const siteOf = (u: URL) => u.host.replace(/^www\./, '');

/** Page URLs listed in the site's sitemaps (robots.txt Sitemap lines, else /sitemap.xml), one index level deep. */
async function sitemapUrls(home: URL): Promise<string[]> {
  const listed = await robotsSitemaps(home.href).catch(() => []);
  const queue = (listed.length ? listed : [new URL('/sitemap.xml', home).href]).slice(0, 3);
  const pages: string[] = [];
  for (let i = 0; i < queue.length && i < 6; i++) {
    const xml = await fetchText(queue[i]!).catch(() => '');
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replaceAll('&amp;', '&'));
    if (/<sitemapindex/i.test(xml)) queue.push(...locs.slice(0, 3));
    else pages.push(...locs);
  }
  return pages;
}

/**
 * The homepage first, then up to max - 1 same-site pages from the sitemap and the homepage's links,
 * preferring about, product, service, pricing, contact, FAQ, terms and refund pages. A site whose
 * links are built by JavaScript yields the homepage alone. Fails only if the homepage cannot be fetched.
 */
export async function pickPages(siteUrl: string, max: number): Promise<string[]> {
  const page = await fetchPage(siteUrl);
  const home = new URL(page.finalUrl);
  const canonical = (u: URL) => `${u.origin}${u.pathname}`;
  const seen = new Set([canonical(home)]);
  const found: URL[] = [];
  const add = (href: string) => {
    let u: URL;
    try {
      u = new URL(href, home);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || siteOf(u) !== siteOf(home) || NOT_A_PAGE.test(u.pathname)) return;
    if (seen.has(canonical(u))) return;
    seen.add(canonical(u));
    found.push(u);
  };
  for (const href of await sitemapUrls(home)) add(href);
  for (const a of parse(page.html).querySelectorAll('a[href]')) add(a.getAttribute('href')!);

  const preferred = (u: URL) => PREFERRED.some((k) => u.pathname.toLowerCase().includes(k));
  const ordered = [...found.filter(preferred), ...found.filter((u) => !preferred(u))];
  return [canonical(home), ...ordered.map(canonical)].slice(0, Math.max(1, max));
}
