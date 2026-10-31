import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord, staleShellFindings, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkStaleShell } from './helpers/visualRules.mjs';

/* When rows leave a plaque, its shell fits the rows that remain at that same step, in
 * its pocket. Francis, 27 October 2026, on Sol n3-14-hu-verbal-particle: "Why does the
 * plaque content disappear then shrink size? if that should be happening, then why do
 * it in 2 steps, just make them disappear and shrink at one step?" At frame 34
 * finite-agreement-checking supersedes the finite-features row of the nominative Case
 * plaque; main kept the two-row shell empty until stage 3 began at frame 36. */

const record = JSON.parse(readFileSync(new URL('./helpers/caseRowsLeaveRecord.json', import.meta.url), 'utf8'));
const subject = 'plaque(0:2 directed-path case-assignment)@a_i';

test('a Case plaque shrinks in place at the step its features row leaves', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: [33, 34, 35, 36] });
  const shells = frames.map(frame => ({ frame: frame.frame, stage: frame.stage, plaque: frame.plaques.find(plaque => plaque.id === subject) }));
  assert.deepEqual(shells.map(({ frame, stage }) => [frame, stage]), [[33, 1], [34, 1], [35, 1], [36, 2]]);
  const [full, left, ...later] = shells.map(({ plaque }) => plaque);
  assert(full.content.height > full.rect.height - 62, 'two rows fill the shell before');
  assert.deepEqual([left.rect.width, left.rect.height], [left.content.width, left.content.height], 'the shell fits the remaining row');
  assert.deepEqual([left.rect.x, left.rect.y], [full.rect.x, full.rect.y], 'in its pocket');
  for (const plaque of later) assert.deepEqual([plaque.rect.width, plaque.rect.height], [left.rect.width, left.rect.height]);
  assert.deepEqual(staleShellFindings(frames), []);
});

test('control: stale-shell reports a shell that keeps a size its content no longer has', () => {
  const plaque = (height, content) => ({ id: 'plaque(0:2 case)@i', text: 'case', rect: { x: 0, y: 0, width: 480, height }, radius: 14,
    claims: ['0:2'], content: { width: 480, height: content } });
  const frame = (number, ...plaques) => ({ frame: number, viewport: 'desktop', zoom: 0.2, texts: [], lines: [], plaques });
  const run = list => { const history = new Map(); return list.flatMap((after, index) => checkStaleShell(list[index - 1], after, history)); };
  assert.deepEqual(run([frame(38, plaque(390, 390)), frame(39, plaque(390, 138)), frame(40, plaque(390, 138))])
    .map(found => [found.subtype, found.frame, found.measure]), [['stale-shell', '38>39', 252], ['stale-shell', '39>40', 252]]);
  assert.deepEqual(run([frame(38, plaque(390, 390)), frame(39, plaque(138, 138))]), [], 'it shrinks with its rows');
  assert.deepEqual(run([frame(38, plaque(390, 138)), frame(39, plaque(390, 390))]), [], 'a shell reserved for a row still to come');
  assert.deepEqual(run([frame(38, plaque(390, 390)), frame(39), frame(40, plaque(390, 138))]), [], 'a plaque shown again starts afresh');
});
