import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord } from './helpers/visualFrames.mjs';

// A seat (seatLandings, movementGapClosing.ts) is refused where it would run a
// trajectory into a tree label, or deeper into one it already grazed
// (keepsLabelsClear). In both analyses of the Spanish subject that raises to
// Spec-IP (sol-spanish-qr), seating the subject at ordinary sister spacing
// beside I' carries the subject's trajectory through V⁰ (the verb's head
// position) from the movement on. Corpus gate layout (1600x948).
const doc = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/sol-spanish-qr.json', import.meta.url), 'utf8'));

const point = (mark, t) => {
  const { start: a, control: b, control2: c, end: d } = mark, u = 1 - t;
  return c ? { x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x, y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y }
    : { x: u * u * a.x + 2 * u * t * b.x + t * t * d.x, y: u * u * a.y + 2 * u * t * b.y + t * t * d.y };
};

/** Each frame's trajectories that run more than a tree unit into a label's or word's glyphs. */
function labelCrossings(index) {
  const record = structuredClone({ ...doc.analyses[index], sentence: doc.sentence, inputTokens: doc.inputTokens });
  const crossings = [];
  for (const frame of layoutVisualFrames(prepareVisualRecord(record), [{ name: 'corpus', width: 1600, height: 948 }]))
    for (const mark of frame.marks.filter(item => item.type === 'trajectory-path' && item.control))
      for (const text of frame.texts.filter(item => item.kind === 'category' || item.kind === 'word'))
        for (const box of text.boxes) {
          let depth = 0;
          for (let step = 0; step <= 200; step++) {
            const { x, y } = point(mark, step / 200);
            depth = Math.max(depth, Math.min(x - box.x, box.x + box.width - x, y - box.y, box.y + box.height - y));
          }
          if (depth > 1) crossings.push(`frame ${frame.frame}: ${mark.id} ${depth.toFixed(1)} into ${text.id}`);
        }
  return crossings;
}

test('a seat never runs a trajectory into a label', () => {
  for (const index of [0, 1]) assert.deepEqual(labelCrossings(index), [], `analysis ${index}`);
});

test('one trajectory already in a label does not hide another newly entering it', async () => {
  const { keepsLabelsClear } = await import('../replay/movementGapClosing.ts');
  // One label; trajectory a already runs 10 units into it before and after the
  // shift, trajectory b is clear before and runs 5 units in after it.
  const before = new Map(), after = new Map();
  const a = { x: 45, y: 0, width: 10, height: 100, trajectory: true, trajectoryKey: 'a' };
  const bBefore = { x: 200, y: 0, width: 5, height: 100, trajectory: true, trajectoryKey: 'b' };
  const bAfter = { x: 30, y: 0, width: 5, height: 100, trajectory: true, trajectoryKey: 'b' };
  const context = {
    scenes: [{ step: {} }], frames: [before],
    inkOf: () => [{ x: 0, y: 0, width: 100, height: 100, connectorAttachment: 'n:category' }],
    plaques: { marks: (_, frame) => [a, frame === before ? bBefore : bAfter] }
  };
  assert.equal(keepsLabelsClear(context, { start: 0, end: 1, view: () => after }), false);
  context.plaques.marks = (_, frame) => [a, bBefore];
  assert.equal(keepsLabelsClear(context, { start: 0, end: 1, view: () => after }), true, 'unchanged paths pass');
});
