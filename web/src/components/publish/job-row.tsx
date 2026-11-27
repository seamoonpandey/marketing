import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Time, JobBadge, PLATFORM, STATE, type Job } from './lib';

/** One job as a card: what, where, when, its state, and what to do about it. Text wraps, never truncates. */
export function JobRow({ job, tz, brandId, cta, showNext = true }: { job: Job; tz: string; brandId: string; cta?: string; showNext?: boolean }) {
  const ch = job.channel;
  return (
    <li className="panel grid gap-2 p-4" data-job-state={job.state}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <JobBadge state={job.state} />
        <span className="font-semibold">{ch ? `${PLATFORM[ch.platform]} · ${ch.accountName}` : 'Channel removed'}</span>
        {job.kind ? <span className="text-sm text-muted">{job.kind}</span> : null}
        <span className="ml-auto text-sm"><Time iso={job.dueAt} tz={tz} /></span>
      </div>
      <p className="break-words">{job.excerpt ?? 'This draft is no longer in Studio.'}</p>
      {job.error ? <p className="text-sm text-danger">{job.error}</p> : null}
      {showNext ? <p className="text-sm text-muted">{STATE[job.state].next}</p> : null}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Link href={`/app/b/${brandId}/publish/jobs/${job.id}`} className={`btn ${cta ? 'btn-primary' : 'btn-secondary'}`}>{cta ?? 'Open'}</Link>
        {job.externalUrl ? (
          <a href={job.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand underline">
            View the post <ExternalLink className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}
