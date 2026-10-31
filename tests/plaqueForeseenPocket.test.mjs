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
 * frame 48, the construction step that paints syntax there. */

const corpus = loadFixtureAnalyses();
const record = corpus.records.find(entry => entry.id === 'replay-regressions/review-workspace-boundaries.json#/cases/0').record;
const subject = 'plaque(5:1 theta theme)@mV';
const offset = plaque => [Math.round(plaque.rect.x - plaque.anchor.x), Math.round(plaque.rect.y - plaque.anchor.y)];

// Since its stage's Agree claims draw Case on their paths (Francis, 30 Oct 2026), a
// pocket 173 units away opens at frame 48 and the early pocket would cost 501, so the
// trade of PR #285 keeps the grid until frame 48, where new syntax (bookBase) takes its
// pocket, and it moves once. Approval: { by: 'Francis', on: '2026-10-30', note: '1. Yes.
// (accepting the Case-on-Agree layouts: n4-13 Location grid 1.17× reach;
// review-workspace-boundaries theme grid moves at step 55)' }, in the lead session.
test('a θ-grid keeps its pocket in stage 8 until new syntax takes it at frame 48, then holds one pocket', () => {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: [45, 46, 47, 48, 49] });
  const pockets = frames.map(frame => ({ frame: frame.frame, stage: frame.stage,
    offset: offset(frame.plaques.find(plaque => plaque.id === subject)) }));
  assert.deepEqual(pockets.map(({ stage }) => stage), [7, 8, 8, 8, 8]);
  assert.deepEqual(pockets.map(({ offset }) => offset), [[66, -15], [66, -15], [66, -15], [174, 120], [174, 120]],
    JSON.stringify(pockets));
  // The move at frame 48 is owned: that frame paints the bookBase label in the earlier pocket.
  const [, , before, at] = frames, prior = before.plaques.find(plaque => plaque.id === subject);
  const box = prior.rect, overlaps = b => b.x < box.x + box.width && box.x < b.x + b.width && b.y < box.y + box.height && box.y < b.y + b.height;
  assert(at.texts.some(text => text.id === 'bookBase:category' && text.boxes.some(overlaps)));
  assert(!before.texts.some(text => text.id === 'bookBase:category' && text.boxes.some(overlaps)));
  assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
});

// Francis, 27 October 2026, asked whether plaques that would jump take the farther
// stretch-clear pocket: "Yes". That trades a jump for a farther pocket, so a plaque that
// leaves its pocket where its stage begins keeps the one it takes through that stage
// beside its still anchor. PR #285 review, 29 October 2026: the unfixed schedule moved
// these early and then moved them again, the θ-grid of reviewed-construction returning
// within reach at frame 14, the one of ordinary-receiving giving way at frame 33 to the
// 2:2 feature plaque that arrives there.
for (const [id, subject, steps] of [
  ['replay-regressions/reviewed-construction.json#/cases/2', 'plaque(0:0 theta agent)@vRestored', [11, 16]],
  ['replay-regressions/ordinary-receiving-width-control.json#', 'plaque(0:0/0:1/1:2 theta theme)@p_v', [27, 36]]
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

// PR #285 review, 29 October 2026: at 9ef8615 this θ-grid took a farther pocket where
// stage 1 began (frame 12), held it through stage 2 and moved again where stage 3 began
// (frame 21), where main moves it once (frame 14). A plaque keeps an early pocket until
// its anchor moves (here at frame 34) or it leaves, across stage boundaries, and takes
// one only where that costs no more moves beside its still anchor than main, nor more
// than a twentieth farther in all; otherwise it does what main does.
test('a plaque that takes a pocket early moves no more often beside its still anchor than without it', () => {
  const id = 'replay-regressions/reviewed-construction.json#/cases/2', subject = 'plaque(0:0 theta agent)@vRestored';
  const visual = prepareVisualRecord(corpus.records.find(entry => entry.id === id).record);
  for (const viewport of [VIEWPORTS[0], VIEWPORTS.find(entry => entry.name === 'mobile')]) {
    const frames = layoutVisualFrames(visual, [viewport], { steps: Array.from({ length: 25 }, (_, at) => 9 + at) });
    const offsets = frames.map(frame => `${frame.frame} ${offset(frame.plaques.find(plaque => plaque.id === subject))}`);
    const pockets = offsets.map(entry => entry.split(' ')[1]).filter((pocket, at, all) => at === 0 || pocket !== all[at - 1]);
    assert(pockets.length <= 2, `${viewport.name}: one move from frame 9 to 33: ${offsets.join(', ')}`);
  }
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

// Coordinator's decision on PR #285, 29 October 2026: a plaque that does not take a
// pocket early does exactly what main does and is judged by main's mark-motion rule
// and excuses. These two plaques have no early pocket that is the trade (one would
// travel 613 then 824 units, the other 694 for main's 60), so each moves once beside
// its still anchor as on main, for syntax its stage paints in its pocket, which main's
// rule excuses.
for (const [id, subject, steps, at, shift] of [
  ['replay-regressions/reviewed-construction.json#/cases/2', 'plaque(0:0 theta agent)@vRestored', [11, 16], 14, 267],
  ['showcase/movement.json#/cases/2', 'plaque(0:2 theta agent/theme)@rec', [76, 81], 79, 60]
]) test(`a plaque without an early pocket moves and is judged as on main: ${id}`, () => {
  const visual = prepareVisualRecord(corpus.records.find(entry => entry.id === id).record);
  const frames = layoutVisualFrames(visual, [VIEWPORTS[0]], { steps: Array.from({ length: steps[1] - steps[0] + 1 }, (_, n) => steps[0] + n) });
  const moves = frames.slice(1).flatMap((frame, n) => {
    const [a, b] = [frames[n], frame].map(entry => offset(entry.plaques.find(plaque => plaque.id === subject)));
    const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return moved > 4 ? [[frame.frame, Math.round(moved)]] : [];
  });
  assert.deepEqual(moves, [[at, shift]]);
  assert.deepEqual(markMotionFindings(frames).map(found => `${found.frame} ${found.subject} ${found.measure}`), []);
});
