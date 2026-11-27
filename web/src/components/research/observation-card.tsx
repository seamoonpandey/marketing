import { ArrowRightLeft, BadgePercent, CircleSlash, Megaphone, PackageMinus, PackagePlus, Pencil, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { SourceQuote } from '@/components/app';
import { formatDate, TYPE_LABEL, type Observation } from './lib';

const ICON: Record<Observation['type'], LucideIcon> = {
  price_change: ArrowRightLeft,
  new_offer: BadgePercent,
  offer_ended: CircleSlash,
  new_product: PackagePlus,
  product_removed: PackageMinus,
  messaging_change: Megaphone,
  other: Pencil,
};

/** One real change: what it is, who, when, and the words before and after, each with its page. */
export function ObservationCard({ o, brandId, showCompetitor = true }: { o: Observation; brandId: string; showCompetitor?: boolean }) {
  const Icon = ICON[o.type];
  const source = { kind: 'page' as const, uri: o.url, meta: {} };
  return (
    <article className="panel grid gap-4 p-5" aria-label={`${TYPE_LABEL[o.type]}: ${o.summary}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--theme-brand)_12%,transparent)] pr-2.5 pl-2 text-xs font-medium text-brand">
          <Icon className="size-3.5" strokeWidth={2} aria-hidden />
          {TYPE_LABEL[o.type]}
        </span>
        {showCompetitor ? (
          o.competitorName ? (
            <Link href={`/app/b/${brandId}/research/competitors/${o.competitorId}`} className="font-semibold underline decoration-line-strong hover:decoration-current">
              {o.competitorName}
            </Link>
          ) : (
            <span className="text-muted">Removed competitor</span>
          )
        ) : null}
        <span className="text-muted">
          <time dateTime={o.observedAt}>{formatDate(o.observedAt)}</time> · {o.confidence} confidence
        </span>
      </div>
      <p className="text-lg font-semibold break-words">{o.summary}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Before</h3>
          {o.before ? <SourceQuote quote={o.before.quote} source={source} /> : <p className="rounded-md border border-dashed border-line-strong px-3.5 py-3 text-sm text-muted">Not on the page before.</p>}
        </div>
        <div className="grid content-start gap-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">After</h3>
          {o.after ? <SourceQuote quote={o.after.quote} source={source} /> : <p className="rounded-md border border-dashed border-line-strong px-3.5 py-3 text-sm text-muted">No longer on the page.</p>}
        </div>
      </div>
    </article>
  );
}
