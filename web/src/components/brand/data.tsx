'use client';

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from '@/lib/api/client';

export type Fact = Schemas['Fact'];
export type FieldDef = Schemas['FieldDef'];
export type SectionDef = Schemas['SectionDef'];
export type FactValue = Schemas['FactValue'];

const key = (brandId: string, name: string) => ['kb', brandId, name] as const;
const path = (brandId: string) => ({ params: { path: { brandId } } });

export const useCatalogue = (b: string) =>
  useQuery({ queryKey: key(b, 'catalogue'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/catalogue', path(b))), staleTime: Infinity });

/** Every page of facts: the server pages at 500 and answers with the next cursor. */
export const useFacts = (b: string) =>
  useQuery({
    queryKey: key(b, 'facts'),
    queryFn: async () => {
      const items: Fact[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(api.GET('/api/brands/{brandId}/knowledge/facts', { params: { path: { brandId: b }, query: { limit: 500, cursor } } }));
        items.push(...page.items);
        cursor = page.next ?? undefined;
      } while (cursor);
      return items;
    },
  });
export const useBook = (b: string) => useQuery({ queryKey: key(b, 'book'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/book', path(b))) });
export const usePalette = (b: string) => useQuery({ queryKey: key(b, 'palette'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/palette', path(b))) });
export const useCompetitors = (b: string) => useQuery({ queryKey: key(b, 'competitors'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/competitors', path(b))) });
export const useSources = (b: string) => useQuery({ queryKey: key(b, 'sources'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/sources', path(b))) });
export const useAssets = (b: string) => useQuery({ queryKey: key(b, 'assets'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/assets', path(b))) });
export const useSubjects = (b: string) => useQuery({ queryKey: key(b, 'subjects'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/subjects', { params: { path: { brandId: b }, query: {} } })) });
export const useImports = (b: string) => useQuery({ queryKey: key(b, 'imports'), queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/imports', path(b))) });
export const importKey = (b: string, runId: string) => key(b, `import-${runId}`);

// fetch has no upload progress, so the PUT to storage uses XHR.
function put(url: string, file: File, type: string, onPct: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`The file could not be stored (${x.status}).`)));
    x.onerror = () => reject(new Error('The upload was interrupted. Try the file again.'));
    x.send(file);
  });
}

/** Uploads a file as a source: registers it, PUTs it to storage, then the server checks the bytes. */
export async function uploadFile(brandId: string, file: File, onPct: (n: number) => void = () => {}): Promise<Schemas['Source']> {
  const mime = file.type || 'application/octet-stream';
  const made = await unwrap(api.POST('/api/brands/{brandId}/sources/uploads', { params: { path: { brandId } }, body: { filename: file.name, mime, bytes: file.size } }));
  await put(made.uploadUrl, file, mime, onPct);
  return unwrap(api.POST('/api/brands/{brandId}/sources/{id}/complete', { params: { path: { brandId, id: made.source.id } } }));
}

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
