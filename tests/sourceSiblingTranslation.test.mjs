import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { sourceSiblingTranslation } from '../replay/sourceSiblingTranslation.ts';

const branch = (id, children = []) => ({ id, label: id, ...(children.length ? { children } : {}) });
const snapshot = root => root.descendants().map(node => [getNodeId(node), node.x, node.y,
  node.children?.map(getNodeId)]);

function scenario({ side = 'right', mirror = false } = {}) {
  const source = branch('source', [branch('source-head', [branch('source-word')])]);
  const sister = branch('sister', [branch('inner'), branch('edge')]);
  const root = d3.hierarchy(branch('parent', side === 'right' ? [sister, source] : [source, sister]));
  applyVizIds(root);
  const reflect = x => mirror ? 1000 - x : x;
  const orient = x => reflect(side === 'right' ? x : 300 - x);
  const initial = {
    parent: [100, 0], sister: [60, 80], inner: [20, 140], edge: [120, 140],
    source: [180, 80], 'source-head': [195, 140], 'source-word': [195, 210]
  };
  const current = new Map(root.descendants().map(node => {
    const [x, y] = initial[getNodeId(node)];
    node.x = orient(x); node.y = y;
    return [getNodeId(node), node];
  }));
  const reserved = new Map(Object.entries({
    parent: [125, 100], sister: [90, 180], inner: [-50, 240], edge: [180, 260],
    source: [800, 50], 'source-head': [800, 70], 'source-word': [800, 90]
  }).map(([id, [x, y]]) => [id, { x: orient(x), y }]));
  const relocated = new Set(['source', 'source-head', 'source-word']);
  return { root, source: current.get('source'), sister: current.get('sister'), current, reserved, relocated };
}

for (const side of ['left', 'right']) for (const mirror of [false, true]) {
  test(`${side} source, ${mirror ? 'mirrored' : 'ordinary'} coordinates: retain the sister contour gap and source shape`, () => {
    const { root, source, sister, current, reserved, relocated } = scenario({ side, mirror });
    const originalTree = snapshot(root), originalReservations = structuredClone(reserved);
    const originalRelocated = [...relocated], originalCurrent = [...current];
    const translation = sourceSiblingTranslation(source, root, current, reserved, relocated);
    const sign = (side === 'right' ? 1 : -1) * (mirror ? -1 : 1);
    assert.deepEqual(translation, { x: 60 * sign, y: 100 });

    const moved = source.descendants().map(node => ({ id: getNodeId(node),
      x: node.x + translation.x, y: node.y + translation.y }));
    const facingEdge = source.x > sister.x ? Math.max : Math.min;
    const oldEdge = facingEdge(...sister.descendants().map(node => node.x));
    const newEdge = facingEdge(...sister.descendants().map(node => reserved.get(getNodeId(node)).x));
    assert.equal(moved[0].x - newEdge, source.x - oldEdge,
      'changing the sister width cannot consume the source clearance');
    assert.equal(moved[0].y - reserved.get('sister').y, source.y - sister.y,
      'current sisters retain their relative rank');
    for (const [index, node] of source.descendants().entries()) {
      assert.equal(moved[index].x - moved[0].x, node.x - source.x);
      assert.equal(moved[index].y - moved[0].y, node.y - source.y);
    }
    assert.notEqual(moved.at(-1).y - moved[0].y,
      reserved.get('source-word').y - reserved.get('source').y,
      'the compact future source does not replace the current branch lengths');
    assert.deepEqual(snapshot(root), originalTree);
    assert.deepEqual(reserved, originalReservations);
    assert.deepEqual([...relocated], originalRelocated);
    assert.deepEqual([...current], originalCurrent);
  });
}

test('a future descendant outside the current visible map supplies no contour', () => {
  const fixture = scenario();
  const { root, source, current, reserved, relocated } = fixture;
  current.delete('edge');
  reserved.set('edge', { x: 9000, y: 260 });
  assert.deepEqual(sourceSiblingTranslation(source, root, current, reserved, relocated), { x: 30, y: 100 });
});

test('a current descendant without a reserved point supplies no contour', () => {
  const { root, source, current, reserved, relocated } = scenario();
  reserved.delete('edge');
  assert.deepEqual(sourceSiblingTranslation(source, root, current, reserved, relocated), { x: 30, y: 100 });
});

for (const mirror of [false, true]) test(`a detached visible island cannot supply the sister contour, mirrored=${mirror}`, () => {
  const root = d3.hierarchy(branch('parent', [
    branch('sister', [branch('unbuilt', [branch('loose')])]), branch('source')
  ]));
  applyVizIds(root);
  const reflect = x => mirror ? 1000 - x : x;
  const points = { parent: [150, 0], sister: [0, 80], source: [300, 80], unbuilt: [50, 160], loose: [100, 240] };
  const current = new Map(root.descendants().map(node => {
    const [x, y] = points[getNodeId(node)]; node.x = reflect(x); node.y = y;
    return [getNodeId(node), node];
  }));
  current.delete('unbuilt');
  const reserved = new Map([...current].map(([id, node]) => [id, { x: node.x, y: node.y }]));
  reserved.set('loose', { x: reflect(900), y: 240 });
  assert.deepEqual(sourceSiblingTranslation(current.get('source'), root, current,
    reserved, new Set(['source'])), { x: 0, y: 0 },
  'an unavailable parent separates the loose node from the connected sister');
});

test('a relocated descendant cannot supply a stationary sister contour', () => {
  const { root, source, current, reserved, relocated } = scenario();
  relocated.add('edge');
  reserved.set('edge', { x: 9000, y: 260 });
  assert.deepEqual(sourceSiblingTranslation(source, root, current, reserved, relocated), { x: 30, y: 100 });
});

for (const [name, change] of [
  ['invisible sister', ({ current }) => current.delete('sister')],
  ['relocated sister', ({ relocated }) => relocated.add('sister')],
  ['unreserved sister', ({ reserved }) => reserved.delete('sister')],
  ['vertically aligned sister', ({ sister, source }) => { sister.x = source.x; }],
  ['no sister', ({ root, source }) => { root.children = [source]; }]
]) test(`${name} cannot anchor the source`, () => {
  const fixture = scenario(); change(fixture);
  const { root, source, current, reserved, relocated } = fixture;
  assert.equal(sourceSiblingTranslation(source, root, current, reserved, relocated), undefined);
});

for (const mirror of [false, true]) for (const conflict of ['none', 'horizontal', 'vertical']) {
  test(`n-ary fork, ${mirror ? 'mirrored' : 'ordinary'} coordinates, ${conflict} conflict`, () => {
    const root = d3.hierarchy(branch('parent', [branch('left'), branch('source'), branch('right')]));
    applyVizIds(root);
    const reflect = x => mirror ? 1000 - x : x;
    const current = new Map(root.descendants().map((node, index) => {
      node.x = reflect(index * 100); node.y = index ? 80 : 0;
      return [getNodeId(node), node];
    }));
    const reserved = new Map([...current].map(([id, node]) => [id,
      { x: node.x + (mirror ? -40 : 40), y: node.y + 70 }]));
    if (conflict === 'horizontal') reserved.get('right').x += 20;
    if (conflict === 'vertical') reserved.get('right').y += 20;
    const before = snapshot(root), points = structuredClone(reserved);
    const translation = sourceSiblingTranslation(current.get('source'), root, current,
      reserved, new Set(['source']));
    assert.deepEqual(translation, conflict === 'none' ? { x: mirror ? -40 : 40, y: 70 } : undefined,
      'all current sister clearances must admit the same rigid translation');
    root.children.reverse();
    assert.deepEqual(sourceSiblingTranslation(current.get('source'), root, current,
      reserved, new Set(['source'])), translation, 'child iteration order does not resolve a conflict');
    root.children.reverse();
    assert.deepEqual(snapshot(root), before);
    assert.deepEqual(reserved, points);
  });
}
