'use client';

import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Async, BackLink, PageHeader, SourceQuote, StateBlock, useBrandId } from '@/components/app';
import { hasStatus } from '@/lib/api/client';
import { httpUrl } from '@/lib/url';
import { BattlecardSection } from './battlecard';
import { useCompetitors, useObservations, useProfile } from './lib';
import { ObservationCard } from './observation-card';
import { WatchList } from './watch-list';

const KIND = { positioning: 'Positioning', product: 'Products', offer: 'Offers', cta: 'Calls to action' } as const;

export function CompetitorView() {
  const brandId = useBrandId()!;
  const { competitorId } = useParams<{ competitorId: string }>();
  const competitors = useCompetitors(brandId);
  return (
    <Async q={competitors} what="competitor">
      {(list) => {
        const c = list.find((x) => x.id === competitorId);
        if (!c)
          return (
            <StateBlock state="error" title="This competitor was not found" action={<Link href={`/app/b/${brandId}/research`} className="btn btn-secondary">Back to Research</Link>}>
              It may have been removed, or the link is wrong.
            </StateBlock>
          );
        return (
          <>
            <BackLink href={`/app/b/${brandId}/research`}>Back to Research</BackLink>
            <PageHeader
              title={c.name}
              description={<>{c.kind[0]!.toUpperCase() + c.kind.slice(1)} competitor{c.site ? <> · <span className="break-all">{c.site.replace(/^https?:\/\//, '')}</span></> : null}</>}
              actions={
                httpUrl(c.adLibraryUrl) ? (
                  <a href={httpUrl(c.adLibraryUrl)!}target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                    Ad library<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : undefined
              }
            />
            <div className="grid gap-10">
              <WatchList brandId={brandId} competitorId={c.id} site={c.site} />
              <ChangeLog brandId={brandId} competitorId={c.id} />
              <Profile brandId={brandId} competitorId={c.id} />
              <BattlecardSection brandId={brandId} competitorId={c.id} />
            </div>
          </>
        );
      }}
    </Async>
  );
}

function ChangeLog({ brandId, competitorId }: { brandId: string; competitorId: string }) {
  const q = useObservations(brandId, competitorId);
  return (
    <section aria-labelledby="log-h" className="grid gap-3">
      <h2 id="log-h" className="text-xl font-semibold">Change log</h2>
      <Async q={q} what="change log">
        {(list) =>
          list.length === 0 ? (
            <StateBlock state="empty" size="inline" title="No changes seen yet">Changes appear here after a run finds one on a watched page.</StateBlock>
          ) : (
            <ul className="grid gap-4">{list.map((o) => <li key={o.id}><ObservationCard o={o} brandId={brandId} showCompetitor={false} /></li>)}</ul>
          )
        }
      </Async>
    </section>
  );
}

function Profile({ brandId, competitorId }: { brandId: string; competitorId: string }) {
  const q = useProfile(brandId, competitorId);
  return (
    <section aria-labelledby="prof-h" className="grid gap-3">
      <h2 id="prof-h" className="text-xl font-semibold">Profile</h2>
      {q.isError && hasStatus(q.error, 404) ? (
        <StateBlock state="empty" size="inline" title="No profile yet">The baseline run reads the watched pages and writes it.</StateBlock>
      ) : (
        <Async q={q} what="profile">
          {(p) =>
            p.entries.length === 0 ? (
              <StateBlock state="empty" size="inline" title="The profile is empty">Nothing on the watched pages could be quoted.</StateBlock>
            ) : (
              <div className="grid gap-5">
                {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
                  const rows = p.entries.filter((e) => e.kind === k);
                  return rows.length ? (
                    <div key={k} className="grid gap-2">
                      <h3 className="text-sm font-semibold text-muted">{KIND[k]}</h3>
                      <ul className="grid gap-3 md:grid-cols-2">
                        {rows.map((e, i) => (
                          <li key={i} className="panel grid content-start gap-2 p-4">
                            <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-semibold"><span className="break-words">{e.text}</span>{e.price ? <span className="num">{e.price}</span> : null}</p>
                            <SourceQuote quote={e.quote} source={{ kind: 'page', uri: e.url, meta: {} }} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })}
              </div>
            )
          }
        </Async>
      )}
    </section>
  );
}
