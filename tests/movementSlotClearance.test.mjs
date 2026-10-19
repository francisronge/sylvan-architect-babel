import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { auditVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

/* A later stage's attachment carries its layout back over earlier frames. Where
 * that layout holds a movement's slot for the compact lower occurrence, the
 * complete source painted there before its movement must still clear its sister. */

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/replay-regressions/${name}.json`, import.meta.url), 'utf8'));
const CASES = [
  // whose car stands in Spec-TP (frames 22-26) beside the T′ that stage 6 holds for the trace.
  ['later-occupant-intermediate-landing', 'car', 'was'],
  // Péter stands in Spec-VP (frame 24) beside the V′ that stage 3 holds for the A-trace.
  ['later-occupant-source-before-movement', 'd_pbar', 'd_v']
];
const viewports = VIEWPORTS.filter(viewport => viewport.name !== 'mobile');
// Construction order can depend on later stages, so a frame is named by its
// stage and step rather than by its position in Replay.
const stepNames = record => {
  const seen = new Map();
  return prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps.map(step => {
    const name = JSON.stringify([step.replayFrameIndex, step.replayKind, step.operation, step.targetNodeId,
      step.replayRelationIdentity?.relationIndex]);
    seen.set(name, (seen.get(name) ?? 0) + 1);
    return { stage: step.replayFrameIndex, name: `${name}#${seen.get(name)}` };
  });
};
const overlaps = record => {
  const steps = stepNames(record);
  return auditVisualRecord('slot', record, { viewports, canopy: false }).findings
    .filter(finding => finding.rule === 'glyph-overlap' || finding.rule === 'line-clearance' && finding.subtype === 'branch-text')
    .map(finding => ({ stage: steps[finding.frame - 1].stage,
      key: `${finding.viewport} ${steps[finding.frame - 1].name}: ${finding.rule} ${finding.subject}`, frame: finding.frame }));
};

for (const [name, occupant, sister] of CASES) {
  const record = fixture(name);
  test(`${name}: the source standing in a held slot clears its sister`, () => {
    const found = overlaps(record).map(entry => `frame ${entry.frame} ${entry.key}`);
    assert.deepEqual(found.filter(entry => entry.includes(occupant) && entry.includes(sister)), [], 'the reported collision is gone');
    assert.deepEqual(found, [], 'no text overlap or branch through text in any frame');
  });

  test(`${name}: adding later stages adds no overlap to earlier frames`, () => {
    const full = overlaps(record);
    for (let stages = 1; stages < record.derivationStages.length; stages++) {
      const alone = new Set(overlaps({ ...record, derivationStages: record.derivationStages.slice(0, stages) }).map(entry => entry.key));
      const added = full.filter(entry => entry.stage < stages && !alone.has(entry.key)).map(entry => `frame ${entry.frame} ${entry.key}`);
      assert.deepEqual(added, [], `stages after ${stages} add none of these overlaps`);
    }
  });
}
