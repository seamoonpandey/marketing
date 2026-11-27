'use client';

import { useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StateBlock, type ViewState } from '@/components/app';
import { api, ApiError, unwrap, type Schemas } from '@/lib/api/client';

export type Fact = Schemas['Fact'];
export type FieldDef = Schemas['FieldDef'];
export type SectionDef = Schemas['SectionDef'];
export type FactValue = Schemas['FactValue'];

const key = (brandId: string, name: string) => ['kb', brandId, name] as const;
const path = (brandId: string) => ({ params: { path: { brandId } } });

export const useCatalogue = (b: string) =>
  useQuery({ queryKey: key(b, 'catalogue'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/catalogue', path(b))), staleTime: Infinity });

// shortcut: one page of up to 500 facts, no cursor loop; add paging when a brand holds more.
export const useFacts = (b: string) =>
  useQuery({
    queryKey: key(b, 'facts'),
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/facts', { params: { path: { brandId: b }, query: { limit: 500 } } })).then((r) => r.items),
  });
export const useBook = (b: string) => useQuery({ queryKey: key(b, 'book'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/book', path(b))) });
export const usePalette = (b: string) => useQuery({ queryKey: key(b, 'palette'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/palette', path(b))) });
export const useCompetitors = (b: string) => useQuery({ queryKey: key(b, 'competitors'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/competitors', path(b))) });
export const useSources = (b: string) => useQuery({ queryKey: key(b, 'sources'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/sources', path(b))) });
export const useAssets = (b: string) => useQuery({ queryKey: key(b, 'assets'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/assets', path(b))) });
export const useSubjects = (b: string) => useQuery({ queryKey: key(b, 'subjects'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/subjects', { params: { path: { brandId: b }, query: {} } })) });
export const useImports = (b: string) => useQuery({ queryKey: key(b, 'imports'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/imports', path(b))) });
export const importKey = (b: string, runId: string) => key(b, `import-${runId}`);

/** Refetch everything the brand module shows (facts, book, palette, readiness all move together). */
export function refreshAll(client: QueryClient, brandId: string) {
  return client.invalidateQueries({ queryKey: ['kb', brandId] });
}

/** Swaps new versions of facts into the cached list (a version has a new id; `supersedesId` names the old one). */
export function putFacts(client: QueryClient, brandId: string, next: Fact[]) {
  client.setQueryData<Fact[]>(key(brandId, 'facts'), (old) =>
    (old ?? []).map((f) => next.find((n) => n.id === f.id || n.supersedesId === f.id) ?? f),
  );
  void client.invalidateQueries({ queryKey: ['kb', brandId], predicate: (q) => q.queryKey[2] !== 'facts' });
}

export function useRefresh(brandId: string) {
  const client = useQueryClient();
  return () => refreshAll(client, brandId);
}

export function errorState(err: unknown): ViewState {
  if (err instanceof ApiError) {
    if (err.code === 'rate_limited' || err.status === 429) return 'rate_limited';
    if (err.code === 'provider_unavailable') return 'unavailable';
  }
  return 'error';
}

/**
 * Renders a query in its states: loading skeleton, an error with retry, the data, and above the data
 * a stale notice when a refresh failed but the last answer is still on screen.
 */
export function Loaded<T>({ query, what, rows, children }: { query: UseQueryResult<T>; what: string; rows?: number; children: (data: T) => ReactNode }) {
  const retry = (
    <button type="button" className="btn btn-secondary" onClick={() => void query.refetch()}>
      Try again
    </button>
  );
  if (query.data === undefined) {
    if (query.isError) {
      return (
        <StateBlock state={errorState(query.error)} title={`${what} could not be loaded`} action={retry}>
          {query.error.message}
        </StateBlock>
      );
    }
    return <StateBlock state="loading" title={`Loading ${what.toLowerCase()}`} rows={rows} />;
  }
  return (
    <>
      {query.isError ? (
        <div className="mb-4">
          <StateBlock state="stale" size="inline" title="Showing what was loaded before" action={retry}>
            {what} could not be refreshed: {query.error.message}
          </StateBlock>
        </div>
      ) : null}
      {children(query.data)}
    </>
  );
}

/** A fact value as plain text (for labels and accessible names). */
export function valueText(v: FactValue, unit?: string | null): string {
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return unit && typeof v === 'number' ? `${unit} ${s}` : s;
}

/** A fact value in full: lists as bullets, never truncated, tagged with its language for Devanagari shaping. */
export function Value({ value, unit, lang, className = '' }: { value: FactValue; unit?: string | null; lang?: string; className?: string }) {
  if (Array.isArray(value)) {
    return (
      <ul lang={lang} className={`grid list-disc gap-0.5 pl-5 ${className}`}>
        {value.map((v, i) => (
          <li key={i} className="break-words">{v}</li>
        ))}
      </ul>
    );
  }
  return (
    <p lang={lang} className={`break-words whitespace-pre-line ${typeof value === 'number' ? 'num' : ''} ${className}`}>
      {unit && typeof value === 'number' ? <span className="text-muted">{unit} </span> : null}
      {value}
    </p>
  );
}
