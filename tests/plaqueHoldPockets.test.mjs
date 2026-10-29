import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutVisualFrames, markMotionFindings, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

/* Saved analyses where main's Replay schedule and its offline audit disagreed about
 * what blocks a plaque's pocket (replay/relations/pocketHold.ts). Each names the
 * desktop transition main got wrong, the plaque, and whether the plaque keeps its
 * pocket there. */

const corpus = loadFixtureAnalyses();
const recordOf = index => corpus.records.find(entry => entry.id === `replay-regressions/plaque-hold-pockets.json#/cases/${index}`).record;
const offset = plaque => [plaque.rect.x - plaque.anchor.x, plaque.rect.y - plaque.anchor.y];

for (const [index, from, subject, keeps, why, through = from + 1] of [
  [0, 26, 'plaque(0:1 directed-path case-assignment)@relativeVerb', true, 'its claim keeps one identity across the transfer of its Case bearer'],
  [1, 28, 'plaque(0:1 directed-path case-assignment)@rV', false, 'the predication route its stage draws later through its pocket moves it as the stage begins', 49],
  [1, 48, 'plaque(0:1 directed-path case-assignment)@rV', true, 'so that route\'s moment does not move it'],
  [2, 36, 'plaque(5:1 directed-path case-assignment)@tense', true, 'a label its arrow already passed does not move it'],
  [3, 30, 'plaque(1:0 theta Agent/Theme)@verb', true, 'a collector row not yet shown does not move it'],
  [4, 17, 'plaque(2:1 directed-path case-assignment)@lightVerbBase', true, 'a plaque its own arrow joins to syntax does not return within reach'],
  [4, 17, 'plaque(2:0 theta Agent)@lightVerbBase', true, 'the grid beside that plaque keeps its pocket once the plaque keeps its own']
]) {
  // The audit sees why a plaque leaves early in the frames of its stage up to `through`.
  test(`plaque hold ${index}, frame ${from} to ${from + 1}: ${why}`, () => {
    const steps = Array.from({ length: through - from + 1 }, (_, offset) => from + offset);
    const frames = layoutVisualFrames(prepareVisualRecord(recordOf(index)), [VIEWPORTS[0]], { steps });
    assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
    const [before, after] = frames.slice(0, 2).map(frame => frame.plaques.find(plaque => plaque.id === subject));
    assert(before && after, `${subject} shows at both frames`);
    if (keeps) assert.deepEqual(offset(after), offset(before));
    else assert.notDeepEqual(offset(after), offset(before));
  });
}

// A Case plaque keeps one pocket only while its arrow leaves one source. In the
// do-support stage the bare I⁰ waits while do and the past I⁰ are built beneath it,
// then its merge sends the arrow from do. One pocket clear of both arrows and of the
// waiting daughters lay far right of the tree (5.8 times the nearby reach).
test('a Case plaque takes a new pocket where the head it leaves becomes a head complex', async () => {
  const { plaqueNearbyReach } = await import('./helpers/visualRules.mjs');
  const record = corpus.records.find(entry => entry.id === 'replay-regressions/head-rewritten-in-place.json#').record;
  const subject = 'plaque(1:2 directed-path case-assignment)@iFinite';
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]]).filter(frame => frame.frame >= 27 && frame.frame <= 37);
  assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
  const shown = frames.map(frame => ({ frame: frame.frame, plaque: frame.plaques.find(plaque => plaque.id === subject) }));
  assert(shown.every(({ plaque }) => plaque), `${subject} shows from its moment on`);
  const pockets = [...new Set(shown.map(({ plaque }) => JSON.stringify(offset(plaque))))];
  assert.equal(pockets.length, 2, 'one pocket while the arrow leaves I⁰, one while it leaves do');
  assert.deepEqual(shown.filter(({ plaque }) => JSON.stringify(offset(plaque)) === pockets[0]).map(({ frame }) => frame), [27, 28, 29, 30, 31, 32, 33]);
  for (const { frame, plaque } of shown) {
    const size = plaque.size ?? plaque.rect;
    const distance = Math.hypot(plaque.rect.x + size.width / 2 - plaque.anchor.x, plaque.rect.y + size.height / 2 - plaque.anchor.y);
    assert(distance <= 2 * plaqueNearbyReach(size), `frame ${frame}: ${Math.round(distance)} units from its anchor`);
  }
});
