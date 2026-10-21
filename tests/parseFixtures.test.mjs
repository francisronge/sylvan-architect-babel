import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { stripVolatileProvenance } from '../scripts/volatileProvenance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(repoRoot, 'fixtures', 'raw');
const normalizedDir = path.join(repoRoot, 'fixtures', 'normalized');
const fixtureNames = fs.readdirSync(rawDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
  .map((entry) => entry.name)
  .sort();

for (const fixtureName of fixtureNames) {
  test(`normalizes ${fixtureName} to its committed snapshot`, () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(rawDir, fixtureName), 'utf8'));
    const expected = JSON.parse(fs.readFileSync(path.join(normalizedDir, fixtureName), 'utf8'));
    const actual = normalizeParseBundle(
      fixture.payload,
      fixture.framework,
      fixture.sentence,
      fixture.modelRoute,
      true,
      { payloadIntegrityFlags: [] }
    );

    const serializedActual = JSON.parse(JSON.stringify(stripVolatileProvenance(actual)));
    assert.deepEqual(serializedActual, expected);
  });
}
