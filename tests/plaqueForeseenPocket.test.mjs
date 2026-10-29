import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { releasablePhase } from '../replay/stageCamera.ts';
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

// Francis, 27 October 2026, asked whether plaques that would jump take the farther
// stretch-clear pocket: "Yes". That trades a jump for a farther pocket, so a plaque that
// leaves its pocket where its stage begins keeps the one it takes through that stage
// beside its still anchor. PR #285 review, 29 October 2026: the unfixed schedule moved
// these early and then moved them again, the θ-grid of reviewed-construction returning
// within reach at frame 19, the one of ordinary-receiving giving way at frame 38 to the
// 2:2 feature plaque that arrives there.
for (const [id, subject, steps] of [
  ['replay-regressions/reviewed-construction.json#/cases/2', 'plaque(0:0 theta agent)@vRestored', [15, 21]],
  ['replay-regressions/ordinary-receiving-width-control.json#', 'plaque(0:0/0:1/1:2 theta theme)@p_v', [32, 41]]
]) test(`a plaque that leaves its pocket where its stage begins does not move again in that stage: ${id}`, () => {
  const visual = prepareVisualRecord(corpus.records.find(entry => entry.id === id).record);
  const frames = layoutVisualFrames(visual, [VIEWPORTS[0]], { steps: Array.from({ length: steps[1] - steps[0] + 1 }, (_, at) => steps[0] + at) });
  const [last, ...stage] = frames.map(frame => ({ frame: frame.frame, stage: frame.stage, anchor: frame.plaques.find(plaque => plaque.id === subject)?.anchor,
    offset: JSON.stringify(offset(frame.plaques.find(plaque => plaque.id === subject))) }));
  assert(stage.every(entry => entry.stage === stage[0].stage) && last.stage < stage[0].stage, 'the frames after the first are one stage');
  assert(stage.every(entry => Math.hypot(entry.anchor.x - stage[0].anchor.x, entry.anchor.y - stage[0].anchor.y) <= 1), 'its anchor stays still');
  if (stage[0].offset !== last.offset) assert.equal(new Set(stage.map(entry => entry.offset)).size, 1,
    `it keeps the pocket it took: ${stage.map(entry => `${entry.frame} ${entry.offset}`).join(', ')}`);
  assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
});

// A step's hold reads the later steps of its stage, so the schedule enters none of a
// stage's steps while a phase of it can still change: one not yet allocated, or one a
// remote run still open may move nearer (bringNear). Phases here belong to stages
// 0, 1, 1, 1 and 2.
test('the plaque schedule enters no phase of a stage that an open remote run may still change', () => {
  const stages = [0, 1, 1, 1, 2];
  assert.equal(releasablePhase(stages, 2, []), 0, 'stage 1 is not yet allocated');
  assert.equal(releasablePhase(stages, 3, []), 3, 'stage 1 is allocated');
  // The unfixed schedule released phase 1 here, before the run from phase 2 closed.
  assert.equal(releasablePhase(stages, 3, [2]), 0, 'a remote run from the middle of stage 1 is open');
  assert.equal(releasablePhase(stages, 3, [1]), 0, 'a remote run from the start of stage 1 is open');
  assert.equal(releasablePhase(stages, 4, [4]), 3, 'a remote run of stage 2 holds back only stage 2');
});

// Allocation keeps each plaque's largest size by plaqueIdentity; the hold pass keeps a
// pocket by claimIdentity, which differs once a claim moves to a lower occurrence. The
// unfixed hold read the sizes with claimIdentity, missed, and fell back to the step's
// smaller size, so its nearby reach was short. Every read goes through allocatedSize.
test('the plaque schedule reads lifetime sizes only by the identity allocation keeps them by', () => {
  const source = readFileSync(new URL('../replay/stageCamera.ts', import.meta.url), 'utf8');
  const reads = [...source.matchAll(/sizes\.get\(([^)]*\)?)\)/g)].map(match => match[1]);
  assert.deepEqual(reads, ['key', 'plaqueIdentity(item)'], 'the size table itself, and allocatedSize');
});
