import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildCorpusSnapshot } from '../scripts/replayCorpusSnapshot.mjs';
import { loadCorpusManifest } from '../scripts/replayCorpusInputs.mjs';

// Corpus guard records in which holding a head or a phrase at a later step's
// place once laid out a finished workspace wider at its Stage Record. Each names
// the workspace and its width there as main c7baa3f lays it out, measured on the
// corpus gate's layout (1600x948); a closing or hold may narrow it, never widen it.
const root = fileURLToPath(new URL('../', import.meta.url));
const guards = {
  'ordinary-receiving-width-control': { frame: 27, root: 'p_ip', width: 1575 },
  'relative-clause-waiting-clearance': { frame: 45, root: 'relativeIP', width: 1244.8065 },
  'showcase-78-sw-relative': { frame: 44, root: 'dpBook', width: 2845.3125 }
};
const manifest = await loadCorpusManifest(fileURLToPath(new URL('../fixtures/replay-corpus/manifest.json', import.meta.url)));
const { records } = await buildCorpusSnapshot(root, manifest.records.filter(record => guards[record.id]),
  { width: 1600, height: 948, direction: 'ltr' });

for (const [id, guard] of Object.entries(guards)) test(`${id}: ${guard.root} is no wider at its Stage Record than its plan`, () => {
  const record = records.find(entry => entry.id === id);
  assert.ok(record && !record.error, `${id}: ${record?.error ?? 'not measured'}`);
  const frame = record.frames[guard.frame - 1];
  assert.equal(frame.kind, 'macro');
  const width = frame.widths.find(entry => entry.root === guard.root)?.width;
  assert.ok(width !== undefined && width <= guard.width + 1e-3, `${guard.root} at ${guard.frame}: ${width} > ${guard.width}`);
});
