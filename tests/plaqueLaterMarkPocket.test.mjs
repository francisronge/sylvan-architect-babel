import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { checkMarkDistance } from './helpers/visualRules.mjs';
import { blocksCarriedPocket } from '../replay/relations/plaquePlacement.ts';
import { ownOccupant } from '../replay/relations/pocketHold.ts';

/* A plaque keeps one pocket for its lifetime, clear of every mark painted in that
 * lifetime. A mark its stage first paints after the lifetime ends is no obstacle.
 * In this saved Claude analysis the theta grid of lv2 keeps its pocket from step 31
 * to step 41, where an authored movement changes its anchor's geometry. Main
 * reserved the stem of the tense link T2–v_prom, which stage 5 first paints at step
 * 45, over the pocket below lv2, and placed the grid above the tree at 1.24 nearby
 * reaches (frames 36–41). */

const record = JSON.parse(readFileSync(new URL('./helpers/laterMarkPocketRecord.json', import.meta.url), 'utf8'));
const frames = layoutVisualFrames(prepareVisualRecord(record), [VIEWPORTS[0]], { steps: Array.from({ length: 11 }, (_, i) => 36 + i) });
const grid = frame => frame.plaques.find(plaque => plaque.grid && plaque.anchorNodeId === 'lv2');

test('a plaque is not pushed away by a mark painted only after its pocket lifetime ends', () => {
  const shown = frames.filter(frame => frame.frame <= 41);
  assert.equal(shown.length, 6);
  for (const frame of shown) {
    assert(grid(frame), `frame ${frame.frame} shows the lv2 grid`);
    assert.deepEqual(checkMarkDistance(frame).filter(found => found.subject === grid(frame).id).map(found => found.detail), [],
      `frame ${frame.frame}`);
  }
});

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
