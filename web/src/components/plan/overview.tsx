'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { MoneyText, PageHeader, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { DraftWeek } from './draft-week';
import { Async, fmt, label, useOverview, weekRange, type Campaign } from './lib';

export function Overview() {
  const brandId = useBrandId()!;
  const q = useOverview(brandId);
  const base = `/app/b/${brandId}/plan`;
  return (
    <>
      <PageHeader title="Plan" description="What the brand posts this week and next, and the campaigns behind it. Nothing is final until you approve it." />
      <Async q={q} what="the plan">
        {(o) => (
          <div className="grid gap-10">
            <section aria-labelledby="weeks-h" className="grid gap-4">
              <h2 id="weeks-h" className="text-xl font-semibold">Weeks</h2>
              <ul className="grid gap-4 md:grid-cols-2">
                {o.weeks.map((w, i) => (
                  <li key={w.weekStart}>
                    <article aria-label={i === 0 ? 'This week' : 'Next week'} className="panel grid h-full content-start gap-3 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="grid gap-0.5">
                          <h3 className="font-semibold">{i === 0 ? 'This week' : 'Next week'}</h3>
                          <p className="text-sm text-muted">{weekRange(w.weekStart)}</p>
                        </div>
                        <StatusBadge status={w.status === 'none' ? 'unplanned' : w.status} label={w.status === 'none' ? 'Not drafted' : w.status === 'draft' ? 'Draft' : 'Approved'} />
                      </div>
                      <p className="num text-sm">
                        <span className="text-2xl font-semibold">{w.itemCount}</span> idea{w.itemCount === 1 ? '' : 's'}
                      </p>
                      {w.itemCount > 0 ? (
                        <p className={`text-sm ${w.blockingCount ? 'font-medium text-danger' : 'text-muted'}`}>
                          {w.blockingCount ? `${w.blockingCount} problem${w.blockingCount === 1 ? '' : 's'} block approval` : 'Nothing blocks approval'}
                        </p>
                      ) : null}
                      <Link className="btn btn-secondary justify-self-start" href={`${base}/calendar?week=${w.weekStart}`}>
                        Open the calendar<ArrowRight className="size-4" aria-hidden />
                      </Link>
                    </article>
                  </li>
                ))}
              </ul>
              {o.weeks[0] ? (
                <DraftWeek brandId={brandId} weekStart={o.weeks[0].weekStart} name="this week" ready={o.ready} latestRun={o.weeks[0].latestRun} hasItems={o.weeks[0].itemCount > 0} />
              ) : null}
            </section>

            <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-2">
              <section aria-labelledby="camp-h" className="grid gap-3">
                <h2 id="camp-h" className="text-xl font-semibold">Active campaigns</h2>
                {o.activeCampaigns.length === 0 ? (
                  <StateBlock state="empty" size="inline" title="No active campaigns" action={<Link className="btn btn-secondary" href={`${base}/campaigns`}>Start one</Link>}>
                    A campaign gives the weeks a goal and an offer to talk about.
                  </StateBlock>
                ) : (
                  <ul className="panel divide-y divide-line">
                    {o.activeCampaigns.map((c) => <CampaignRow key={c.id} c={c} href={`${base}/campaigns/${c.id}`} />)}
                  </ul>
                )}
              </section>

              <section aria-labelledby="opp-h" className="grid gap-3">
                <h2 id="opp-h" className="text-xl font-semibold">Accepted opportunities</h2>
                {o.opportunities.length === 0 ? (
                  <StateBlock state="empty" size="inline" title="No opportunities waiting">
                    Opportunities you accept in Research that have no campaign yet appear here.
                  </StateBlock>
                ) : (
                  <ul className="grid gap-3">
                    {o.opportunities.map((x) => (
                      <li key={x.id}>
                        <article aria-label={x.title} className="panel grid gap-2 p-4">
                          <h3 className="font-semibold break-words">{x.title}</h3>
                          <p className="text-sm break-words text-muted">{x.suggestedAction}</p>
                          <Link className="btn btn-secondary justify-self-start" href={`${base}/campaigns?opportunity=${x.id}&name=${encodeURIComponent(x.title)}`}>
                            Start a campaign<span className="sr-only">: {x.title}</span>
                          </Link>
                        </article>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <p className="flex flex-wrap gap-2 text-sm">
              <span className="text-muted">Planning cost this month</span>
              <span className="font-semibold"><MoneyText value={o.monthCost} /></span>
            </p>
          </div>
        )}
      </Async>
    </>
  );
}

export function CampaignRow({ c, href }: { c: Campaign; href: string }) {
  return (
    <li>
      <Link href={href} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)]">
        <span className="grid min-w-0 gap-0.5">
          <span className="font-semibold break-words">{c.name}</span>
          <span className="text-sm text-muted">
            {label(c.objective)}
            {c.startsOn ? ` · ${fmt(c.startsOn)}${c.endsOn ? ` to ${fmt(c.endsOn)}` : ''}` : ''}
          </span>
        </span>
        <StatusBadge status={c.status} label={label(c.status)} />
      </Link>
    </li>
  );
}
