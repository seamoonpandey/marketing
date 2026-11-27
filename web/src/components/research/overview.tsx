'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Async, PageHeader, StateBlock, useBrandId } from '@/components/app';
import { useCompetitors, useObservations, useRuns, useTargets } from './lib';
import { ObservationCard } from './observation-card';
import { RunPanel } from './run-panel';
import { SchedulePanel } from './schedule-panel';

export function Overview() {
  const brandId = useBrandId()!;
  const competitors = useCompetitors(brandId);
  return (
    <>
      <PageHeader title="Research" description="What your competitors changed on their pages, with the words before and after." />
      <Async q={competitors} what="competitors">
        {(list) =>
          list.length === 0 ? (
            <StateBlock
              state="empty"
              title="No competitors to watch yet"
              action={<Link href={`/app/b/${brandId}/brand/review`} className="btn btn-primary">Review the brand</Link>}
            >
              Competitors are named while the brand is reviewed. Add them there, then come back to choose the pages to watch.
            </StateBlock>
          ) : (
            <Body brandId={brandId} competitors={list} />
          )
        }
      </Async>
    </>
  );
}

function Body({ brandId, competitors }: { brandId: string; competitors: { id: string; name: string; site: string | null }[] }) {
  const targets = useTargets(brandId);
  return (
    <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid gap-10">
        <RunPanel brandId={brandId} hasTargets={(targets.data?.length ?? 0) > 0} />
        <Changes brandId={brandId} />
      </div>
      <aside className="grid gap-10" aria-label="Competitors and schedule">
        <section aria-labelledby="comp-h" className="grid gap-3">
          <h2 id="comp-h" className="text-xl font-semibold">Competitors</h2>
          <ul className="panel divide-y divide-line">
            {competitors.map((c) => (
              <li key={c.id}>
                <Link href={`/app/b/${brandId}/research/competitors/${c.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)]">
                  <span className="grid min-w-0 gap-0.5">
                    <span className="font-semibold break-words">{c.name}</span>
                    {c.site ? <span className="text-sm break-all text-muted">{c.site.replace(/^https?:\/\//, '')}</span> : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          <Link href={`/app/b/${brandId}/research/opportunities`} className="btn btn-secondary justify-self-start">See opportunities</Link>
        </section>
        <SchedulePanel brandId={brandId} />
      </aside>
    </div>
  );
}

function Changes({ brandId }: { brandId: string }) {
  const observations = useObservations(brandId);
  const runs = useRuns(brandId);
  const lastDone = runs.data?.find((r) => r.state === 'completed');
  return (
    <section aria-labelledby="changes-h" className="grid gap-3">
      <h2 id="changes-h" className="text-xl font-semibold">What changed</h2>
      <Async q={observations} what="changes">
        {(all) => {
          if (all.length === 0)
            return (
              <StateBlock state="empty" title="No changes yet">
                {lastDone ? 'The last run found no real change on the watched pages. Unchanged pages cost nothing.' : 'Once the baseline has run, each real change on a watched page appears here.'}
              </StateBlock>
            );
          const fresh = all.filter((o) => o.runId === lastDone?.id);
          const earlier = all.filter((o) => o.runId !== lastDone?.id);
          return (
            <>
              {lastDone ? (
                <>
                  <h3 className="text-sm font-semibold text-muted">Since the last run</h3>
                  {fresh.length ? <Cards list={fresh} brandId={brandId} /> : <StateBlock state="empty" size="inline" title="Nothing new in the last run" />}
                </>
              ) : null}
              {earlier.length ? (
                <>
                  {lastDone ? <h3 className="pt-3 text-sm font-semibold text-muted">Earlier</h3> : null}
                  <Cards list={earlier} brandId={brandId} />
                </>
              ) : null}
            </>
          );
        }}
      </Async>
    </section>
  );
}

function Cards({ list, brandId }: { list: import('./lib').Observation[]; brandId: string }) {
  return (
    <ul className="grid gap-4">
      {list.map((o) => <li key={o.id}><ObservationCard o={o} brandId={brandId} /></li>)}
    </ul>
  );
}
