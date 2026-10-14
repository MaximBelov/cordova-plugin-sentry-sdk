// The shipped TypeScript declarations are a contract: what an app's compiler makes of window.SentrySdk. test/types/consumer.ts is a
// sample consumer, with the lines that have to compile and, under `@ts-expect-error`, the lines that have to be refused.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the declarations give every call the answer it documents, and refuse what it does not accept', () => {
  const tsc = spawnSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(root, 'test/types/tsconfig.json')], { encoding: 'utf8' });
  assert.equal(tsc.status, 0, `tsc refused the sample consumer:\n${tsc.stdout}${tsc.stderr}`);
});
