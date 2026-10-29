import assert from 'node:assert/strict';
import test from 'node:test';
import { bindAnchorSetBadges, bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { projectVisibleAnchorSetOrganization } from '../replay/relations/relationFrame.ts';
import { isPlanItemRevealed } from '../replay/relations/renderPlan.ts';
import { anchorSetBadgeOuterRadius, RELATION_BINDING_METRICS } from '../replay/rendererMetrics.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

// Badge clearance between rails follows the order Replay shows them, so a
// rail's badges never move when a rail that appears later is revealed.
const open = (members, relation = 'Open list') => ({ relation, anchors: { members } });
const ps = ['p1', 'p2', 'p3', 'p4', 'p5'];
const phrase = (id, silent = false) => ({ id, label: 'DP', lineageId: id.replace(/_hi$/, '').toUpperCase(),
  word: id.replace(/_hi$/, ''), ...(silent ? { silent: true } : {}) });
// The open list names b's landing, so Replay plays it after the movement:
// the scope set, authored second, is shown first (anchorRailBands.test.mjs).
const record = { sentence: 'b p1 p2 p3 p4 p5', derivationStages: [
  { statement: 'Phrases.', stageRecord: 'Six phrases are built.', relations: [], workspaceForest: [phrase('b'), ...ps.map(id => phrase(id))] },
  { statement: 'Movement.', stageRecord: 'b moves.', relations: [
    open(['b_hi', ...ps.slice(0, 4)]), open(ps, 'Scope set'),
    { relation: 'Internal Merge', anchors: { lowerCopy: 'b', higherCopy: 'b_hi' }, priorAnchors: { source: 'b' } }],
  workspaceForest: [{ id: 'root', label: 'XP', children: [{ id: 'host_b', label: 'XP', children: [phrase('b_hi'), phrase('b', true)] },
    ...ps.map(id => phrase(id))] }] }] };
const order = ['b_hi', 'b', ...ps];
const positionFor = id => order.includes(id) ? { x: order.indexOf(id) * 180, y: 0 } : null;

test('a rail\'s badges hold when a rail authored before it but shown after it is revealed', () => {
  const { playbackSteps, relationRenderPlan: plan } = prepareReplay({ ...structuredClone(record), includePlayback: true });
  const nominal = bindAnchorSetBadges(plan, 1, positionFor, RELATION_BINDING_METRICS)
    .find(badge => badge.nodeId === 'p1' && badge.numeral === 1);
  // A label under p1 reaches past the scope set's nominal badge, so it moves
  // below the label, toward where the open list's band nominally numbers p1.
  const label = { x: nominal.x - 60, y: nominal.y - 41, width: 120, height: 76.4 };
  const timeline = playbackSteps.flatMap((step, index) => {
    if (step.replayFrameIndex !== 1) return [];
    const played = new Set(playbackSteps.slice(0, index + 1).filter(other => other.replayKind === 'relation'
      && other.replayFrameIndex === 1).map(other => other.replayRelationIdentity.relationIndex));
    const active = step.replayKind === 'relation' ? step.replayRelationIdentity.relationIndex : null;
    const revealed = item => isPlanItemRevealed(item, 1, played, active);
    const items = projectVisibleAnchorSetOrganization(plan.frames[1].items, revealed);
    const shown = new Set(items.flatMap((item, itemIndex) => revealed(item) ? [itemIndex] : []));
    const framePlan = { ...plan, frames: plan.frames.map((frame, i) => i === 1 ? { ...frame, items } : frame) };
    const options = { ...RELATION_BINDING_METRICS, badgeObstacles: [label], isItemRevealed: itemIndex => shown.has(itemIndex) };
    const describe = badges => badges.filter(badge => shown.has(badge.itemIndex))
      .map(badge => ({ rail: items[badge.itemIndex].set.relationIndex, nodeId: badge.nodeId, numeral: badge.numeral, y: badge.y }));
    const bound = describe(bindRelationPlanFrame(framePlan, 1, positionFor, options).primitives
      .filter(mark => mark.type === 'anchor-set-badge'));
    // Fit re-places the drawn badges with the same allocation.
    assert.deepEqual(describe(bindAnchorSetBadges(framePlan, 1, positionFor, options)), bound, `step ${index + 1}: Fit agrees`);
    return [{ step: index + 1, bound }];
  });
  const scope = timeline.map(({ step, bound }) => ({ step, badges: JSON.stringify(bound.filter(badge => badge.rail === 1)) }))
    .filter(({ badges }) => badges !== '[]');
  assert.ok(timeline.some(({ bound }) => bound.some(badge => badge.rail === 0)), 'the open list is revealed later');
  assert.ok(JSON.parse(scope[0].badges).find(badge => badge.nodeId === 'p1').y > nominal.y, 'the label moves the scope set\'s badge down');
  for (const { step, badges } of scope) assert.equal(badges, scope[0].badges, `step ${step}: the scope set's badges moved`);
  for (const { step, bound } of timeline) {
    bound.forEach((left, i) => bound.slice(i + 1).forEach(right => assert.ok(
      left.nodeId !== right.nodeId || Math.abs(left.y - right.y) >= 2 * anchorSetBadgeOuterRadius('standard'),
      `step ${step}: badges ${left.rail}:${left.numeral} and ${right.rail}:${right.numeral} at ${left.nodeId} overlap (${left.y}, ${right.y})`)));
  }
});
