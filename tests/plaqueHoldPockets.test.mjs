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

for (const [index, from, subject, keeps, why] of [
  [0, 26, 'plaque(0:1 directed-path case-assignment)@relativeVerb', true, 'its claim keeps one identity across the transfer of its Case bearer'],
  [1, 48, 'plaque(0:1 directed-path case-assignment)@rV', false, 'the predication route newly drawn through its pocket moves it, and the audit agrees'],
  [2, 36, 'plaque(5:1 directed-path case-assignment)@tense', true, 'a label its arrow already passed does not move it'],
  [3, 30, 'plaque(1:0 theta Agent/Theme)@verb', true, 'a collector row not yet shown does not move it'],
  [4, 17, 'plaque(2:1 directed-path case-assignment)@lightVerbBase', true, 'a plaque its own arrow joins to syntax does not return within reach'],
  [4, 17, 'plaque(2:0 theta Agent)@lightVerbBase', true, 'the grid beside that plaque keeps its pocket once the plaque keeps its own']
]) {
  test(`plaque hold ${index}, frame ${from} to ${from + 1}: ${why}`, () => {
    const frames = layoutVisualFrames(prepareVisualRecord(recordOf(index)), [VIEWPORTS[0]], { steps: [from, from + 1] });
    assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
    const [before, after] = frames.map(frame => frame.plaques.find(plaque => plaque.id === subject));
    assert(before && after, `${subject} shows at both frames`);
    if (keeps) assert.deepEqual(offset(after), offset(before));
    else assert.notDeepEqual(offset(after), offset(before));
  });
}
