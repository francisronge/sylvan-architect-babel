import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { layoutVisualFrames, prepareVisualRecord } from './helpers/visualFrames.mjs';

// A seated landing (seatLandings, movementGapClosing.ts) keeps every plaque as
// near its anchor as Replay's plaque layout stood it, including plaques that
// travel with the landing: the syntax they now pass can take their pocket.
// The Spanish subject that raises to Spec-IP (sol-spanish-qr), on the corpus
// gate's layout (1600x948). Frame numbers are 1-based.
const doc = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/sol-spanish-qr.json', import.meta.url), 'utf8'));
const analysis = index => structuredClone({ ...doc.analyses[index], sentence: doc.sentence, inputTokens: doc.inputTokens });

/** Each frame's distance of the plaque whose id starts with `prefix`, at `anchor`, from that anchor. */
function plaqueDistances(record, prefix, anchor) {
  const frames = layoutVisualFrames(prepareVisualRecord(record), [{ name: 'corpus', width: 1600, height: 948 }]);
  return new Map(frames.flatMap(frame => frame.plaques
    .filter(plaque => plaque.anchor && plaque.anchorNodeId === anchor && plaque.id.startsWith(prefix))
    .map(plaque => [frame.frame, Math.hypot(plaque.rect.x + plaque.size.width / 2 - plaque.anchor.x,
      plaque.rect.y + plaque.size.height / 2 - plaque.anchor.y)])));
}

// Analysis 0: seating the subject (and keeping its D-NP fork at the sibling gap
// over its whole life) took the pocket of the verb's theta grid, which then
// stood 410.5 from v instead of 254.7 from its first frame to the movement.
test('seating a landing never takes the pocket of another anchor\'s plaque', () => {
  const distances = plaqueDistances(analysis(0), 'plaque(0:0 theta', 'v');
  for (const frame of [22, 23, 24, 25, 26, 27]) {
    assert.ok(distances.has(frame), `theta grid shown at frame ${frame}`);
    assert.ok(distances.get(frame) < 256, `theta grid ${distances.get(frame)} from v at frame ${frame}`);
  }
});

// Analysis 1 with the nominative Case claimed on the subject's NP instead of its
// D: the Case plaque travels with the landing, and the seat with the closed
// fork stood it 400.6 from its anchor instead of 313.7. The seat without that
// fork leaves it where it stood.
test('a plaque that travels with a seated landing keeps its pocket against the syntax it now passes', () => {
  const record = analysis(1);
  record.derivationStages[2].relations[1].anchors.subject = 'snp';
  const distances = plaqueDistances(record, 'plaque(2:1 case: nominative)', 'snp');
  for (const frame of [29, 30, 31, 32, 33]) {
    assert.ok(distances.has(frame), `Case plaque shown at frame ${frame}`);
    assert.ok(distances.get(frame) < 315, `Case plaque ${distances.get(frame)} from snp at frame ${frame}`);
  }
});
