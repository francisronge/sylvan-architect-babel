import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { auditVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';

// Saved analyses in which closing a movement's room once took the room a
// proximity plaque stood in beside its anchor, so the plaque layout left the
// plaque beyond its nearby reach (the visual audit's mark-distance). Each names
// the plaques that must stay near.
const { analyses } = JSON.parse(await readFile(new URL('./data/closing-plaque-room.json', import.meta.url), 'utf8'));
const desktop = VIEWPORTS.filter(viewport => viewport.name === 'desktop');
const far = (source, subjects) => auditVisualRecord(source, analyses[source], { viewports: desktop, canopy: false }).findings
  .filter(finding => finding.rule === 'mark-distance' && subjects.some(subject => finding.subject.includes(subject)))
  .map(finding => `${finding.subject} at ${finding.frame}: ${finding.measure}`);

test('Sol n4-38: closing the room the old leave keeps v\'s θ plaques beside it', () => {
  assert.deepEqual(far('sol-cfc/n4-38-en-garden-path analysis 0', ['theta Theme)@v_man', 'theta Agent)@v_man']), []);
});

test('Opus n4-13: a closing keeps the pocket a later trajectory leaves the Location plaque', () => {
  assert.deepEqual(far('opus-final/n4-13-fr-long-relative analysis 0', ['theta Location)@trouvait']), []);
});

test('Opus n4-07: a closing keeps the pocket another anchor\'s plaque leaves the Case feature plaque', () => {
  assert.deepEqual(far('opus-final/n4-07-en-cleft-relative analysis 1', ['features: Case:accusative)@v1']), []);
});
