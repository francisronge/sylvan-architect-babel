import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutVisualFrames, markMotionFindings, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';

/* A plaque does not keep a pocket that syntax its stage lays out in advance will
 * take while the plaque is still shown beside a still anchor (pocketHold.ts,
 * foreseenPocketBlocker). Francis, 27 October 2026, on a θ-grid left above a noun
 * whose N′ was projected there next: "plaque fucking teleports because IT IS PUT IN
 * THE WORST POSITION POSSIBLE, LITERALLY ABOVE SOMETHING THAT IS ABOUT TO BE
 * PROJECTED". Main kept this θ-grid's stage-7 pocket into stage 8 and moved it at
 * frame 55, the construction step that paints syntax there. */

const corpus = loadFixtureAnalyses();
const record = corpus.records.find(entry => entry.id === 'replay-regressions/review-workspace-boundaries.json#/cases/0').record;
const subject = 'plaque(5:1 theta theme)@mV';
const offset = plaque => [Math.round(plaque.rect.x - plaque.anchor.x), Math.round(plaque.rect.y - plaque.anchor.y)];

test('a θ-grid leaves a pocket its stage will build syntax in as the stage begins, not at that construction step', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: [52, 53, 54, 55, 56] });
  const pockets = frames.map(frame => ({ frame: frame.frame, stage: frame.stage,
    offset: offset(frame.plaques.find(plaque => plaque.id === subject)) }));
  assert.deepEqual(pockets.map(({ stage }) => stage), [7, 8, 8, 8, 8]);
  const [last, ...stage8] = pockets;
  assert.notDeepEqual(stage8[0].offset, last.offset, 'it moves where stage 8 begins');
  assert.deepEqual(new Set(stage8.map(({ offset }) => JSON.stringify(offset))).size, 1, `one pocket through stage 8: ${JSON.stringify(pockets)}`);
  assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
});
