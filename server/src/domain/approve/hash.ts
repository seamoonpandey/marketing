import { createHash } from 'node:crypto';
import type { ReadyDraft } from './studio.ts';

/** Exactly what an approval binds to. Render order is kept: it is the order the files go out in. */
export type Payload = {
  objectType: 'studio_draft'; objectId: string; version: number; channel: string; day: string;
  kind: string; content: unknown; renders: { ratio: string; sha256: string }[];
};

/** The payload of a draft that is ready at its current version, or null. A file without a checksum cannot be bound to, so it makes the draft unapprovable. */
export function payloadOf(d: ReadyDraft): Payload | null {
  if (d.status !== 'ready' || d.readyVersion !== d.currentVersion) return null;
  if (d.renders.some((r) => typeof r.sha256 !== 'string' || !r.sha256)) return null;
  return {
    objectType: 'studio_draft', objectId: d.id, version: d.currentVersion, channel: d.channel, day: d.day, kind: d.kind,
    content: d.content, renders: d.renders.map((r) => ({ ratio: r.ratio, sha256: r.sha256 })),
  };
}

/** JSON with object keys sorted at every depth. Strings are not normalised: text that differs in any code point is a different payload. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Hex SHA-256 of the canonical JSON of a payload. */
export function payloadHash(p: Payload): string {
  return createHash('sha256').update(canonical(p)).digest('hex');
}
