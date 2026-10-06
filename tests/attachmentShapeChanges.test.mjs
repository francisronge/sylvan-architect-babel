import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { attachmentShapeChanges } from '../replay/attachmentShapeChanges.ts';

function scene({ attached = false, dx = 0, dy = 0, childX = 0, childY = 100,
  secondX = 80, changedWord = false, hiddenParent = false, extraChild = false } = {}) {
  const component = { id: 'phrase', label: 'XP', children: [
    { id: 'word', label: 'word', word: changedWord ? 'different' : 'same' },
    { id: 'second', label: 'Y' }
  ] };
  if (extraChild) component.children.push({ id: 'new', label: 'Z' });
  const root = d3.hierarchy(attached ? { id: 'parent', label: 'TP', children: [component] } : component);
  applyVizIds(root);
  const positions = { parent: [dx, dy - 100], phrase: [dx, dy], word: [dx + childX, dy + childY],
    second: [dx + secondX, dy + 100], new: [dx + 100, dy + 100] };
  return new Map(root.descendants().filter(node => !(hiddenParent && getNodeId(node) === 'parent')).map(node => {
    const [x, y] = positions[getNodeId(node)];
    return [getNodeId(node), Object.assign(node, { x, y })];
  }));
}
const increased = (baseline, candidate) => [...candidate].some(([pair, value]) => value > (baseline.get(pair) ?? 0) + 1e-6);
for (const sign of [1, -1]) {
  test(`${sign}: an unchanged component may attach by rigid translation`, () => {
    const changes = attachmentShapeChanges(scene(), scene({ attached: true, dx: sign * 400, dy: 500 }));
    assert.equal(changes.size, 3);
    assert([...changes.values()].every(value => value === 0));
  });
  test(`${sign}: the actual merge cannot hide new internal horizontal or rank deformation`, () => {
    const before = scene(), baseline = attachmentShapeChanges(before, scene({ attached: true }));
    assert(increased(baseline, attachmentShapeChanges(before, scene({ attached: true, childX: sign * 40 }))));
    assert(increased(baseline, attachmentShapeChanges(before, scene({ attached: true, childY: 120 }))));
  });
  test(`${sign}: per-member comparison cannot trade an old deformation for a different member`, () => {
    const before = scene();
    const baseline = attachmentShapeChanges(before, scene({ attached: true, childX: sign * 100 }));
    const candidate = attachmentShapeChanges(before, scene({ attached: true, secondX: 80 + sign * 90 }));
    assert(Math.max(...candidate.values()) < Math.max(...baseline.values()));
    assert(increased(baseline, candidate));
  });
}

test('genuine material and topology changes are not unchanged-component attachments', () => {
  assert.equal(attachmentShapeChanges(scene(), scene({ attached: true, changedWord: true })).size, 0);
  assert.equal(attachmentShapeChanges(scene(), scene({ attached: true, extraChild: true })).size, 0);
});
test('invisible ancestry does not create a false attachment', () => {
  assert.equal(attachmentShapeChanges(scene(), scene({ attached: true, hiddenParent: true })).size, 0);
});
test('measuring deformation preserves all original nodes and coordinates', () => {
  const before = scene(), after = scene({ attached: true, childX: 30 });
  const capture = nodes => [...nodes].map(([id, node]) => [id, node.data, node.x, node.y]);
  const original = structuredClone([capture(before), capture(after)]);
  attachmentShapeChanges(before, after);
  assert.deepEqual([capture(before), capture(after)], original);
});
