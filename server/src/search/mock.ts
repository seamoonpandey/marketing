import type { SearchHit, SearchKind } from './index.ts';

const FAIL = Symbol('fail');
const answers = new Map<string, SearchHit[] | typeof FAIL>();
const key = (kind: SearchKind, query: string) => `${kind}\n${query}`;

/** The provider behind SEARCH_PROVIDER=mock. An unknown query answers []. Tests only. */
export const mockSearch = {
  set(kind: SearchKind, query: string, hits: SearchHit[]): void {
    answers.set(key(kind, query), hits);
  },
  /** Make this query throw. */
  fail(kind: SearchKind, query: string): void {
    answers.set(key(kind, query), FAIL);
  },
  calls: [] as { kind: SearchKind; query: string; country: string }[],
  reset(): void {
    answers.clear();
    mockSearch.calls.length = 0;
  },
  async run(kind: SearchKind, query: string, country: string): Promise<SearchHit[]> {
    mockSearch.calls.push({ kind, query, country });
    const a = answers.get(key(kind, query));
    if (a === FAIL) throw new Error('mock search failed');
    return a ?? [];
  },
};
