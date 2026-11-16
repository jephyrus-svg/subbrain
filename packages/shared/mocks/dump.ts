// node --experimental-strip-types mocks/dump.ts → mocks/json/<name>.json
import * as F from './fixtures.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('./json/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const [name, value] of Object.entries(F)) {
  writeFileSync(new URL(`${name}.json`, out), JSON.stringify(value, null, 2) + '\n');
}
console.log(`wrote ${Object.keys(F).length} files`);
