// `pnpm openapi` writes openapi.json from the Zod contracts; `pnpm openapi:check [file]` exits 1 when it is stale.
import { readFileSync, writeFileSync } from 'node:fs';
import { createApp, OPENAPI_INFO } from '../src/app.ts';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? new URL('../openapi.json', import.meta.url).pathname;
const text = `${JSON.stringify(createApp().getOpenAPI31Document(OPENAPI_INFO), null, 2)}\n`;

if (args.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {}
  if (current !== text) {
    console.error(`${file} is stale: run \`pnpm openapi\` and commit the result.`);
    process.exit(1);
  }
} else {
  writeFileSync(file, text);
}
