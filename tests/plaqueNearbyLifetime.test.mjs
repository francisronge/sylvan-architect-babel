import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { auditVisualRecord, layoutVisualFrames, prepareVisualRecord, VIEWPORTS } from './helpers/visualFrames.mjs';
import { plaqueNearbyReach } from './helpers/visualRules.mjs';

/* A plaque that shows its owner only by proximity stays within its nearby reach.
 * Where no nearby pocket stays clear for its whole lifetime, its pocket lasts until
 * the first phase that blocks every nearby one, instead of a remote pocket clear of
 * everything the lifetime will ever show. Its moves still follow the pocket-hold
 * contract: none while its anchor holds and nothing new needs its pocket.
 *
 * Before this, the diverse-recovery analysis left the Theme grid on the base verb
 * 35% beyond its reach for 21 frames at 1440×900, and its tense plaque 18% beyond.
 * In saved Claude Opus 5.5 runs the same lifetime pocket held a complement-form
 * plaque about four rows above its anchor, at 2.24 times its reach, for 51 frames.
 * The other analyses guard plaques whose anchors move or whose landings are
 * reclaimed, which take a pocket per anchor position. */

const fixtures = new Map(loadFixtureAnalyses().records.map(({ id, record }) => [id, record]));
const DESKTOP = VIEWPORTS.filter(viewport => viewport.name === 'desktop');

for (const id of ['replay-regressions/workspace-arabic-continuity.json#/cases/5', 'showcase/movement.json#/cases/1',
  'replay-regressions/diverse-recovery.json#/examples/7/analysis', 'replay-regressions/landing-claimed-again.json#'])
  test(`proximity plaques stay within nearby reach, and move only where the pocket-hold contract allows (${id})`, () => {
    const { findings } = auditVisualRecord(id, fixtures.get(id), { viewports: DESKTOP, canopy: false });
    const places = rule => findings.filter(finding => finding.rule === rule).map(finding => `${finding.frame} ${finding.subject} ${finding.measure}`);
    assert.deepEqual(places('mark-distance'), []);
    assert.deepEqual(places('mark-motion'), []);
  });

/* Plaques joined to syntax by their own Case arrow choose after proximity plaques
 * and are exempt from the mark-distance audit, so a proximity plaque's nearer pocket
 * could push one far away unseen. A proximity plaque leaving its lifetime pocket
 * reserves the pockets joined plaques hold in that phase. Without that reservation,
 * the Case plaque of claims 0:1 and 1:1 on vTrace went from 0.52 to 2.09 times its
 * nearby reach at 1440×900. */
test('a proximity plaque coming nearer leaves a joined Case plaque its pocket (case-collection-growth)', () => {
  const id = 'visual-relations/case-collection-growth.json#';
  const plaques = layoutVisualFrames(prepareVisualRecord(fixtures.get(id)), DESKTOP).flatMap(frame => frame.plaques
    .filter(plaque => plaque.joined && plaque.anchor && plaque.id === 'plaque(0:1/1:1 directed-path case-assignment)@vTrace')
    .map(plaque => ({ frame: frame.frame, plaque })));
  assert(plaques.length > 5, 'the plaque is shown');
  const far = plaques.flatMap(({ frame, plaque }) => {
    const size = plaque.size ?? plaque.rect;
    const ratio = Math.hypot(plaque.rect.x + size.width / 2 - plaque.anchor.x, plaque.rect.y + size.height / 2 - plaque.anchor.y)
      / plaqueNearbyReach(size);
    return ratio > 1 ? [`frame ${frame}: ${ratio.toFixed(2)}`] : [];
  });
  assert.deepEqual(far, []);
});
