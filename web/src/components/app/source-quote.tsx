import { ExternalLink, FileText } from 'lucide-react';
import type { Schemas } from '@/lib/api/client';
import { httpUrl } from '@/lib/url';

type QuoteSource = Pick<Schemas['Source'], 'kind' | 'uri' | 'meta'> & { downloadUrl?: string };

function pageLabel(uri: string, title: unknown): string {
  if (typeof title === 'string' && title.trim()) return title.trim();
  try {
    const u = new URL(uri);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return uri;
  }
}

/**
 * A verbatim quote and where it came from: the page it was read on (opens in a new tab), or the
 * uploaded file (downloads) and its page number.
 */
export function SourceQuote({ quote, source, page }: { quote: string; source: QuoteSource; page?: number }) {
  const isPage = source.kind === 'page';
  const label = isPage ? pageLabel(source.uri, source.meta.title) : String(source.meta.filename ?? 'Uploaded file');
  const href = isPage ? httpUrl(source.uri) : source.downloadUrl;
  const Icon = isPage ? ExternalLink : FileText;
  return (
    <figure className="grid gap-2 rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)] px-3.5 py-3">
      <blockquote className="max-w-[70ch] text-[0.9375rem] leading-relaxed">
        <p>“{quote}”</p>
      </blockquote>
      <figcaption className="flex min-w-0 items-baseline gap-1.5 text-sm text-muted">
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {href ? (
          <a
            href={href}
            className="min-w-0 break-words text-action underline decoration-line-strong hover:decoration-current"
            {...(isPage ? { target: '_blank', rel: 'noopener noreferrer' } : { download: label })}
          >
            {label}
            {isPage ? <span className="sr-only"> (opens in a new tab)</span> : null}
          </a>
        ) : (
          <span className="min-w-0 break-words">{label}</span>
        )}
        {page ? <span className="shrink-0" aria-label={`page ${page}`}>· page {page}</span> : null}
      </figcaption>
    </figure>
  );
}
