'use client';

import { useId } from 'react';
import type { Money } from '@/lib/api/client';
import { MoneyText } from './money-text';

type Props = {
  estimate: Money;
  /** What the tenant may still spend this month (GET /api/brands/{brandId}/costs → remaining). */
  remaining: Money;
  onConfirm: () => void;
  onCancel?: () => void;
  /** True while the confirmed job is being started. */
  pending?: boolean;
  /** What is being paid for, e.g. "Reading 8 pages and 3 files". */
  children?: React.ReactNode;
};

/**
 * Shows what an AI job may cost against what is left of this month's budget and asks for
 * confirmation. A job that costs more than is left cannot be confirmed.
 */
export function CostConfirm({ estimate, remaining, onConfirm, onCancel, pending, children }: Props) {
  const id = useId();
  const over = Number(estimate.npr) > Number(remaining.npr);
  return (
    <section aria-labelledby={`${id}-title`} className="panel grid gap-5 p-5 sm:p-6">
      <div className="grid gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold">Confirm the cost</h2>
        {children ? <div className="text-sm text-muted">{children}</div> : null}
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <dt className="text-sm text-muted">This job, at most</dt>
          <dd className="text-2xl font-semibold"><MoneyText value={estimate} /></dd>
        </div>
        <div className="grid gap-1">
          <dt className="text-sm text-muted">Left in this month’s AI budget</dt>
          <dd className="text-2xl font-semibold text-muted"><MoneyText value={remaining} /></dd>
        </div>
      </dl>
      <p id={`${id}-note`} className={`text-sm ${over ? 'font-medium text-danger' : 'text-muted'}`}>
        {over
          ? 'This job could cost more than is left this month, so it cannot start. Remove some sources or wait for next month’s budget.'
          : 'The estimate prices every page and file at list price, plus the longest answer. You pay for what is used, never more.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={over || pending}
          aria-describedby={`${id}-note`}
        >
          {pending ? 'Starting…' : 'Confirm and start'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={pending}>
            Not now
          </button>
        ) : null}
      </div>
    </section>
  );
}
