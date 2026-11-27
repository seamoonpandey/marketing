'use client';

import Link from 'next/link';
import { Async, PageHeader, StateBlock, useBrandId } from '@/components/app';
import { JobRow } from './job-row';
import { STATE, useSummary, type Job, type JobState } from './lib';

const COUNTED: JobState[] = ['scheduled', 'awaiting_manual', 'unknown', 'blocked', 'failed', 'published'];

export function Dashboard() {
  const brandId = useBrandId()!;
  const q = useSummary(brandId);
  return (
    <>
      <PageHeader
        title="Publish"
        description="Posts go out at the time you choose. Today every channel is posted by hand: you get the finished copy and image, post it, and paste the link back."
        actions={
          <>
            <Link href={`/app/b/${brandId}/publish/settings`} className="btn btn-secondary">Settings</Link>
            <Link href={`/app/b/${brandId}/publish/calendar`} className="btn btn-primary">Schedule a draft</Link>
          </>
        }
      />
      <Async q={q} what="publishing overview">
        {(s) => {
          if (!s.hasChannels) {
            return (
              <StateBlock state="empty" title="Add a channel to start" action={<Link href={`/app/b/${brandId}/publish/channels`} className="btn btn-primary">Add a channel</Link>}>
                A channel is an account you post to, such as your Instagram page. Add one, then schedule approved drafts to it.
              </StateBlock>
            );
          }
          return (
            <div className="grid gap-10">
              <dl className="flex flex-wrap gap-2" aria-label="Jobs by state">
                {COUNTED.map((st) => (
                  <div key={st} className="panel flex min-w-[7.5rem] flex-1 flex-col px-3 py-2">
                    <dt className="text-xs text-muted">{STATE[st].label}</dt>
                    <dd className="num text-xl font-semibold">{s.counts[st]}</dd>
                  </div>
                ))}
              </dl>
              <Section id="now" title="Post by hand now" empty="Nothing is waiting for you to post." jobs={s.manualNow} tz={s.timezone} brandId={brandId} cta="Open and post" />
              <Section id="attention" title="Needs your attention" empty="Nothing needs attention." jobs={s.attention} tz={s.timezone} brandId={brandId} cta="Resolve" />
              <Section id="soon" title="Coming up in the next seven days" empty="Nothing is scheduled for the next seven days. Schedule an approved draft from the calendar." jobs={s.upcoming} tz={s.timezone} brandId={brandId} />
              <Section id="out" title="Went out" empty="Nothing has been published yet." jobs={s.published} tz={s.timezone} brandId={brandId} showNext={false} />
            </div>
          );
        }}
      </Async>
    </>
  );
}

function Section({ id, title, empty, jobs, tz, brandId, cta, showNext }: { id: string; title: string; empty: string; jobs: Job[]; tz: string; brandId: string; cta?: string; showNext?: boolean }) {
  return (
    <section aria-labelledby={`${id}-h`} className="grid gap-3">
      <h2 id={`${id}-h`} className="text-xl font-semibold">{title}</h2>
      {jobs.length ? (
        <ul className="grid gap-3">{jobs.map((j) => <JobRow key={j.id} job={j} tz={tz} brandId={brandId} cta={cta} showNext={showNext} />)}</ul>
      ) : (
        <StateBlock state="empty" size="inline" title={empty} />
      )}
    </section>
  );
}
