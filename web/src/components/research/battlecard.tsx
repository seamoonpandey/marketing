'use client';

import { CircleCheck } from 'lucide-react';
import { Async, MutationError, StateBlock, StatusBadge } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { formatDate, useAct, useBattlecard } from './lib';

type Card = NonNullable<Schemas['Battlecard']>;

const PARTS: [keyof Card['body'], string][] = [
  ['differ', 'Where we differ'],
  ['proof', 'Proof'],
  ['objections', 'Likely objections'],
  ['responses', 'How to respond'],
];

export function BattlecardSection({ brandId, competitorId }: { brandId: string; competitorId: string }) {
  const card = useBattlecard(brandId, competitorId);
  const path = { path: { brandId, competitorId } };
  const generate = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/competitors/{competitorId}/battlecard/generate', { params: path })));
  const approve = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/competitors/{competitorId}/battlecard/approve', { params: path })));
  return (
    <section aria-labelledby="bc-h" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bc-h" className="text-xl font-semibold">Battlecard</h2>
        <button type="button" className="btn btn-secondary" onClick={() => generate.mutate()} disabled={generate.isPending}>
          {generate.isPending ? 'Writing…' : 'Generate a draft'}
        </button>
      </div>
      <MutationError error={generate.error ?? approve.error} />
      <Async q={card} what="battlecard">
        {({ approved, draft }) =>
          !approved && !draft ? (
            <StateBlock state="empty" size="inline" title="No battlecard yet">A draft uses only facts you have approved and what was seen on the competitor’s pages. You approve it before anyone uses it.</StateBlock>
          ) : (
            <>
              {draft ? <Version card={draft} onApprove={() => approve.mutate()} pending={approve.isPending} /> : null}
              {approved ? <Version card={approved} /> : null}
            </>
          )
        }
      </Async>
    </section>
  );
}

function Version({ card, onApprove, pending }: { card: Card; onApprove?: () => void; pending?: boolean }) {
  const draft = card.status === 'draft';
  return (
    <article className="panel grid gap-5 p-5" aria-label={`Battlecard version ${card.version}, ${card.status}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-lg font-semibold">Version {card.version}</h3>
          {draft ? <StatusBadge status="unverified" label="Draft" /> : <StatusBadge status="approved" />}
          <span className="text-sm text-muted">{draft ? `Written ${formatDate(card.createdAt)}` : `Approved ${formatDate(card.approvedAt)}`}</span>
        </div>
        {draft && onApprove ? (
          <button type="button" className="btn btn-primary" onClick={onApprove} disabled={pending}>
            <CircleCheck className="size-4" aria-hidden />{pending ? 'Approving…' : 'Approve this version'}
          </button>
        ) : null}
      </div>
      {PARTS.map(([k, title]) => (
        <div key={k} className="grid gap-2">
          <h4 className="text-sm font-semibold text-muted">{title}</h4>
          {card.body[k].length ? (
            <ul className="grid gap-2">
              {card.body[k].map((s, i) => (
                <li key={i} className="grid gap-0.5 border-l-2 border-line-strong pl-3">
                  <span className="break-words">{s.text}</span>
                  <span className="text-xs text-muted">
                    {[s.factIds?.length ? `${s.factIds.length} approved fact${s.factIds.length === 1 ? '' : 's'}` : '', s.observationIds?.length ? `${s.observationIds.length} observation${s.observationIds.length === 1 ? '' : 's'}` : '', s.profileQuote ? `Seen on their site: “${s.profileQuote}”` : ''].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing here that could be backed.</p>
          )}
        </div>
      ))}
      <div className="grid gap-2 rounded-md bg-[color-mix(in_oklab,var(--theme-highlight)_22%,transparent)] p-4">
        <h4 className="text-sm font-semibold">Left out ({card.leftOut.length})</h4>
        {card.leftOut.length ? (
          <>
            <p className="text-sm text-muted">These statements were removed because nothing approved backs them.</p>
            <ul className="grid gap-2" aria-label="Left out">
              {card.leftOut.map((l, i) => (
                <li key={i} className="text-sm"><span className="break-words">{l.text}</span> <span className="text-muted">— {l.reason}</span></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">Every statement is backed.</p>
        )}
      </div>
    </article>
  );
}
