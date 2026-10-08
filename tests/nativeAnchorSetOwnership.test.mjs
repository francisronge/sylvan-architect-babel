import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  compileRelationRenderPlan, isPlanItemRevealed, planItemDependencyNodeIds,
  projectVisibleAnchorSetOrganization
} from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, fitFallbackGeometry } from '../replay/relations/geometryBinding.ts';

const examples = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/pf-correspondence-evidence.json', import.meta.url)))
  .examples.filter(example => example.id.includes('spanish'));
const nodes = forest => forest.flatMap(function walk(node) { return [node, ...(node.children ?? []).flatMap(walk)]; });

// TreeVisualizer binds every frame item for stable allocation, then filters
// paint by owner and witnesses. Never replace this with a filtered test plan.
const nativeBind = (plan, stages, index, played, active, hide = () => false) => {
  const rawItems = plan.frames[index].items;
  const visibleNodes = new Set(nodes(stages[index].workspaceForest).map(node => node.id));
  const revealed = (item, itemIndex) => !hide(item, itemIndex) && isPlanItemRevealed(item, index, played, active);
  const items = projectVisibleAnchorSetOrganization(rawItems, (item, itemIndex) => revealed(item, itemIndex)
    && planItemDependencyNodeIds(item).every(id => visibleNodes.has(id)));
  assert.equal(items.length, rawItems.length, 'native plaque and mark indices cannot shift');
  rawItems.forEach((item, itemIndex) => {
    if (item.kind !== 'anchor-set' || !revealed(item, itemIndex)) assert.equal(items[itemIndex], item,
      'unrelated and hidden allocation records remain in their exact original slots');
  });
  const revealedIndices = new Set(items.flatMap((item, itemIndex) => revealed(item, itemIndex) ? [itemIndex] : []));
  const ids = [...visibleNodes];
  const displayedPlan = { ...plan, frames: plan.frames.map((frame, i) => i === index ? { ...frame, items } : frame) };
  const bound = bindRelationPlanFrame(displayedPlan, index,
    id => visibleNodes.has(id) ? { x: ids.indexOf(id) * 140, y: 0 } : null,
    { isItemRevealed: itemIndex => revealedIndices.has(itemIndex), separateFallbackMoments: true });
  const visible = bound.primitives.filter(primitive => {
    if (!revealedIndices.has(primitive.itemIndex)) return false;
    const item = items[primitive.itemIndex];
    if (item.kind === 'fallback' && primitive.type === 'fallback-mark') return visibleNodes.has(primitive.nodeId);
    if (item.kind === 'fallback' && primitive.type === 'segment') return primitive.witnessNodeIds.every(id => visibleNodes.has(id));
    return planItemDependencyNodeIds(item).every(id => visibleNodes.has(id));
  });
  return { items, bound, visible };
};

for (const example of examples) test(`${example.id}: native full-frame allocation preserves supported badges after neutral paint disappears`, () => {
  const stage = structuredClone(example.stage);
  // A later plaque must reserve its original slot before its relation plays.
  stage.relations.push({ relation: 'PFRealization', anchors: { stem: 'sub' }, values: { number: 'singular' } });
  const stages = [stage, { ...stage, relations: [] }];
  const plan = compileRelationRenderPlan(stages), original = structuredClone(plan);
  const belongs = (items, primitive) => items[primitive.itemIndex].relationRef.stageIndex === 0
    && items[primitive.itemIndex].relationRef.relationIndex === example.relationIndex;
  for (let read = 0; read < 2; read++) {
    const before = nativeBind(plan, stages, 0, new Set(), null);
    assert(!before.visible.some(primitive => belongs(before.items, primitive)));
    const moment = nativeBind(plan, stages, 0, new Set([example.relationIndex]), example.relationIndex);
    const momentRails = moment.visible.filter(primitive => primitive.type === 'anchor-set-rail' && belongs(moment.items, primitive));
    assert.equal(momentRails.length, 2, 'raw mixed owners compose to exactly one visible rail for each authored role');
    assert(momentRails.every(rail => rail.anchors.length === 5));
    if (Math.max(momentRails[0].x1, momentRails[1].x1) < Math.min(momentRails[0].x2, momentRails[1].x2)) {
      assert.notEqual(momentRails[0].lane, momentRails[1].lane, 'overlapping roles require distinct lanes');
    }
    assert(!moment.visible.some(primitive => primitive.type === 'anchor-set-badge' && belongs(moment.items, primitive)),
      'the owning moment reuses its exact neutral context numerals without duplicating them');
    for (const index of [0, 1]) {
      const after = nativeBind(plan, stages, index, index ? new Set() : new Set([example.relationIndex]), null);
      const own = after.visible.filter(primitive => belongs(after.items, primitive));
      const badges = own.filter(primitive => primitive.type === 'anchor-set-badge');
      assert.deepEqual(badges.map(badge => badge.numeral), [1, 2, 5, 1, 2, 5]);
      const rails = own.filter(primitive => primitive.type === 'anchor-set-rail');
      assert.equal(rails.length, 2);
      assert(rails.every(rail => rail.anchors.every(anchor => badges.includes(anchor))),
        'every join terminates at its actual visible supported badge, never a hidden fallback position');
      assert(!own.some(primitive => primitive.type === 'fallback-mark'));
      if (!index) assert(after.bound.primitives.some(primitive => primitive.type === 'fallback-mark'),
        'hidden fallback geometry still exists for allocation; this test exercises native paint filtering');
      const fitted = fitFallbackGeometry(after.bound, { fittedMarkerScale: 1, fittedAnchorScale: 1,
        markerScale: 1, separateFallbackMoments: true });
      for (const rail of rails) {
        const fittedRail = fitted.get(rail);
        assert(fittedRail);
        assert.deepEqual(fittedRail.anchors.map(anchor => [anchor.nodeId, anchor.x, anchor.y]),
          rail.anchors.map(anchor => [anchor.nodeId, anchor.x, anchor.y]));
        assert(fittedRail.anchors.every(anchor => anchor.type === 'anchor-set-badge'));
      }
    }
    assert.deepEqual(plan, original, 'seeking and rebinding do not mutate the prepared plan or allocation');
  }
});

test('native organization projection keeps an independent visible owner when its companion is hidden', () => {
  const members = ['a', 'b', 'c', 'd', 'e'];
  const stage = { statement: 'Test', stageRecord: 'Test', workspaceForest: [...members, 'note'].map(id => ({ id, label: 'XP' })),
    relations: [{ relation: 'OpenChorus', anchors: { members, occurrences: members, annotation: 'note' } }] };
  const plan = compileRelationRenderPlan([stage]), original = structuredClone(plan);
  const hide = item => item.kind === 'anchor-set' && item.tier2FacetId === 'organization.large-anchor-set';
  const after = nativeBind(plan, [stage], 0, new Set([0]), null, hide);
  const badges = after.visible.filter(primitive => primitive.type === 'anchor-set-badge');
  assert.deepEqual(badges.map(badge => badge.numeral), [1, 2, 3, 4, 5]);
  const rails = after.visible.filter(primitive => primitive.type === 'anchor-set-rail');
  assert.equal(rails.length, 1);
  assert(rails[0].anchors.every(anchor => badges.includes(anchor)));
  assert.deepEqual(after.items[rails[0].itemIndex].set.roles.map(role => role.role), ['occurrences']);
  assert(after.bound.primitives.some(primitive => hide(after.items[primitive.itemIndex])),
    'the hidden companion still reserves geometry and keeps its original allocation index');
  assert.deepEqual(plan, original);
});
