import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname;
const check = (file: string) => spawnSync('node', ['scripts/openapi.ts', '--check', file], { cwd: root, encoding: 'utf8' });

describe('openapi:check', () => {
  it('passes for the committed openapi.json and fails for a stale one', () => {
    const current = readFileSync(join(root, 'openapi.json'), 'utf8');
    const dir = mkdtempSync(join(tmpdir(), 'openapi-'));
    writeFileSync(join(dir, 'fresh.json'), current);
    expect(check(join(dir, 'fresh.json')).status).toBe(0);

    const stale = JSON.parse(current);
    delete stale.paths['/api/brands'];
    writeFileSync(join(dir, 'stale.json'), JSON.stringify(stale, null, 2));
    const r = check(join(dir, 'stale.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/stale/);
  });
});
