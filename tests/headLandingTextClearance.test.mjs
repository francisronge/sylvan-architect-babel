import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { paintedTextCollisions } from '../replay/treeTextCollision.ts';
import { auditVisualRecord, TEXT_METRICS, VIEWPORTS } from './helpers/visualFrames.mjs';

const record = JSON.parse(readFileSync(new URL('./helpers/applicativeHeadLandingRecord.json', import.meta.url)));

// Opus's Xhosa applicative: stage 3 moves V phek into the Appl complex, whose
// left daughter it becomes. The attachment plan kept the complex at the old
// Appl head's place, beside the specifier NP abantwana. It checks ink only
// between separate components, and the coherent solve that separates sister
// contours ran only where a component reflows, so phek₁ landed on abantwana.
test('a head landing beside a specifier keeps its word clear of the specifier word in every frame and the Canopy', () => {
  const { findings } = auditVisualRecord('applicative-head-landing', record, { viewports: VIEWPORTS });
  assert.deepEqual(findings.filter(finding => finding.rule === 'glyph-overlap')
    .map(finding => `${finding.frame}@${finding.viewport}: ${finding.detail}`), []);
  assert.deepEqual(findings.filter(finding => ['branch-geometry', 'parent-centring'].includes(finding.rule))
    .map(finding => `${finding.frame}@${finding.viewport}: ${finding.detail}`), []);
});

const word = (id, x, text, indices = []) => {
  const node = d3.hierarchy({ id, label: 'N', word: text, children: [] });
  Object.assign(node, { x, y: 0, __vizId: id });
  return { node, runs: [{ kind: 'terminal', text, indices }] };
};
const collisions = (...words) => paintedTextCollisions(words.map(item => item.node),
  new Map(words.map(item => [item.node.data.id, item.runs])), TEXT_METRICS.measureTreeLabel, TEXT_METRICS.measureCategoryText);

test('paintedTextCollisions measures a word with its index run, as the painter draws it', () => {
  const plain = TEXT_METRICS.measureTreeLabel({ kind: 'terminal', text: 'phek', indices: [] }).cell.width;
  const indexed = TEXT_METRICS.measureTreeLabel({ kind: 'terminal', text: 'phek', indices: [{ text: '₁', mode: 'identity' }] }).cell.width;
  assert.ok(indexed > plain + 10, `the index run widens the word (${plain} → ${indexed})`);
  // Halfway between the plain and the indexed word's reach, only the index run meets the other word.
  const half = TEXT_METRICS.measureTreeLabel({ kind: 'terminal', text: 'el', indices: [] }).cell.width / 2, outline = 4;
  const gap = (plain + indexed) / 4 + half + outline;
  assert.deepEqual([...collisions(word('a', 0, 'phek'), word('b', gap, 'el'))], []);
  assert.deepEqual([...collisions(word('a', 0, 'phek', [{ text: '₁', mode: 'identity' }]), word('b', gap, 'el'))], ['a b']);
  // Two outlines that overlap each other, with each clear of the other's glyphs, are not an overlap.
  assert.deepEqual([...collisions(word('a', 0, 'phek'), word('b', plain / 2 + half + outline + 1, 'el'))], []);
  assert.deepEqual([...collisions(word('a', 0, 'phek'), word('b', plain / 2 + half + outline - 1, 'el'))], ['a b']);
});
