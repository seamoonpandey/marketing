import type { ReactNode } from 'react';

/** The page's title (its one h1), an optional line of context, and its primary actions. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6">
      <div className="grid min-w-0 gap-1.5">
        <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
        {description ? <p className="max-w-[65ch] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
