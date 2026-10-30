import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { blocksCarriedPocket } from '../replay/relations/plaquePlacement.ts';
import { ownOccupant } from '../replay/relations/pocketHold.ts';

/* A plaque keeps one pocket for its lifetime, clear of every mark painted in that
 * lifetime; a mark its stage first paints after the lifetime ends is no obstacle while
 * the anchor moves first. In this saved Claude analysis the theta grid of lv2 has a
 * lifetime from step 31 to step 41, but lv2 stands still to the end of stage 5 (step
 * 46), so the Replay step hold keeps the grid's pocket until the stage's tense link
 * T2–v_prom appears at step 45. The pocket must stay clear of that link too: a nearer
 * pocket for steps 31–41 that the link takes made the grid jump 529 units beside lv2
 * at frame 45. */

const record = JSON.parse(readFileSync(new URL('./helpers/laterMarkPocketRecord.json', import.meta.url), 'utf8'));
const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: 11 }, (_, i) => 36 + i) });
const grid = frame => frame.plaques.find(plaque => plaque.grid && plaque.anchorNodeId === 'lv2');

test('control: the pocket stays clear of every mark painted while the plaque holds it', () => {
  // Frames 42–46 hold the grid's next pocket; frame 45 paints the tense link's stem.
  assert(frames.some(frame => frame.frame === 45 && frame.reserves.some(box => box.extendsDownward)), 'frame 45 paints the link stem');
  for (const frame of frames) {
    const plaque = grid(frame), pocket = plaque && { ...plaque.rect, ...plaque.size };
    if (!plaque) continue;
    const blockers = frame.reserves.filter(box => !ownOccupant(plaque.key ?? plaque.id, box) && blocksCarriedPocket(pocket, box));
    assert.deepEqual(blockers, [], `frame ${frame.frame}`);
  }
});

/** Pairs of adjacent frames in one stage where `plaque` keeps its anchor within a unit
 * but changes its offset from it by more than four units. */
const offsetJumps = (list, plaqueOf) => list.slice(1).flatMap((frame, index) => {
  const before = list[index], a = plaqueOf(before), b = plaqueOf(frame);
  if (!a || !b || before.stage !== frame.stage || Math.hypot(b.anchor.x - a.anchor.x, b.anchor.y - a.anchor.y) > 1) return [];
  const shift = Math.hypot(b.rect.x - b.anchor.x - a.rect.x + a.anchor.x, b.rect.y - b.anchor.y - a.rect.y + a.anchor.y);
  return shift > 4 ? [`${before.frame}>${frame.frame}: ${Math.round(shift)} units`] : [];
});

test('a plaque beside a still anchor keeps one offset through the rest of its stage', () => {
  // After the participant movement at frame 42, lv2 stays still to the end of stage 5
  // (frame 46); the grid keeps one offset there, also when the tense link appears at 45.
  const stage = frames.filter(frame => frame.frame >= 42 && frame.stage === 5);
  assert.equal(stage.length, 5);
  for (const frame of stage) assert.deepEqual([frame.painted.get('lv2').x, frame.painted.get('lv2').y],
    [stage[0].painted.get('lv2').x, stage[0].painted.get('lv2').y], `lv2 stays still at frame ${frame.frame}`);
  assert.deepEqual(offsetJumps(stage, grid), []);
});

