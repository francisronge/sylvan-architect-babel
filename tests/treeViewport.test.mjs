import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceFittedCamera, availableTreeViewport, containCamera, enterStageCamera, linearizationViewport, sharedSyntaxTravel,
  stageEntryStartCamera
} from '../components/treeViewport.ts';

test('plaque containment leaves an already fitting camera exactly unchanged', () => {
  const preferred = { x: 173.4, y: 93.1, k: 0.27 };
  assert.equal(containCamera(preferred, { minX: 0, maxX: 800, minY: 0, maxY: 300 },
    { left: 16, right: 790, top: 16, bottom: 450 }), preferred);
});

test('plaque containment pans before shrinking and uses only the necessary shrink', () => {
  const view = { left: 16, right: 784, top: 80, bottom: 484 };
  const preferred = { x: 0, y: 120, k: 0.5 };
  const narrow = { minX: -100, maxX: 500, minY: 0, maxY: 300 };
  assert.deepEqual(containCamera(preferred, narrow, view), { x: 66, y: 120, k: 0.5 });
  const wide = { ...narrow, maxX: 2000, maxY: 1800 };
  const result = containCamera(preferred, wide, view);
  assert.equal(result.k, (view.bottom - view.top) / (wide.maxY - wide.minY));
  for (const [axis, min, max, start, end] of [
    ['x', 'minX', 'maxX', 'left', 'right'], ['y', 'minY', 'maxY', 'top', 'bottom']
  ]) {
    assert(result[axis] + wide[min] * result.k >= view[start] - 1e-7);
    assert(result[axis] + wide[max] * result.k <= view[end] + 1e-7);
  }
  assert.deepEqual(containCamera(result, wide, view), result, 'repeated fitting must not drift');
});

test('automatic fitting excludes measured Replay and app controls on desktop and mobile', () => {
  for (const [width, height, obstacles] of [
    [1600, 920, { headerBottom: 72, panelTop: 644, right: 108 }],
    [390, 530, { headerBottom: 72, panelTop: 323, right: 72 }]
  ]) {
    const view = availableTreeViewport(width, height, obstacles);
    assert.equal(view.top, obstacles.headerBottom + 16);
    assert.equal(view.bottom, obstacles.panelTop - 16);
    assert.equal(view.right, width - obstacles.right);
    assert.ok(view.top < view.bottom);
  }
});

test('Canopy and standalone inspection reserve only controls that actually exist', () => {
  assert.deepEqual(availableTreeViewport(800, 600), { left:16, top:16, right:784, bottom:584 });
  assert.equal(availableTreeViewport(800, 600, { bottom: 250 }).bottom, 350);
});

test('cyclic columns and tree use the same remaining viewport instead of projecting behind Replay', () => {
  for (const width of [390, 1600]) {
    const view = availableTreeViewport(width, 530, { headerBottom: 65, panelTop: 302, right: 72 });
    const layout = linearizationViewport(view, 155);
    assert.ok(layout.top + 155 * layout.scale <= view.bottom);
    assert.ok(layout.left + 350 * layout.scale <= view.right);
    assert.ok(layout.treeTop < view.bottom);
    assert.ok(layout.treeRight > view.left);
    if (width === 390) assert.ok(layout.treeTop >= layout.top + 155 * layout.scale);
    else assert.ok(layout.treeRight < layout.left);
  }
});


test('a same-scale Replay advance retains framing and only pans for actual overflow', () => {
  const previous = { x: 294, y: 72, k: 0.128 };
  const recentered = { ...previous, x: 332 };
  const bounds = { minX: 0, maxX: 5000, minY: 0, maxY: 2100 };
  const view = { left: 16, right: 1264, top: 60, bottom: 430 };
  assert.equal(advanceFittedCamera(previous, recentered, bounds, view), previous);
  const wider = { ...bounds, maxX: 8000 };
  const corrected = advanceFittedCamera(previous, recentered, wider, view);
  assert.equal(corrected.k, previous.k);
  assert.equal(corrected.y, previous.y);
  assert.equal(corrected.x + wider.maxX * corrected.k, view.right);
  const smaller = { ...recentered, k: 0.1 };
  assert.equal(advanceFittedCamera(previous, smaller, bounds, view), smaller);
  const larger = { ...recentered, k: previous.k * 1.08, y: 48 };
  assert.equal(advanceFittedCamera(previous, larger, bounds, view), previous,
    'an eight-percent opportunity to zoom in is not a reason to move the camera');
  const overflow = advanceFittedCamera(previous, larger, { ...bounds, maxX: 12000 }, view);
  assert(overflow.k < previous.k, 'new content still earns the scale reduction needed to remain visible');
});

test('stage entry retains the accepted view only while it holds the shared syntax steadier than the fit', () => {
  const view = { left: 16, right: 1264, top: 60, bottom: 430 };
  const fit = bounds => {
    const k = Math.min((view.right - view.left) / (bounds.maxX - bounds.minX), (view.bottom - view.top) / (bounds.maxY - bounds.minY));
    return { x: (view.left + view.right - (bounds.minX + bounds.maxX) * k) / 2,
      y: (view.top + view.bottom - (bounds.minY + bounds.maxY) * k) / 2, k };
  };
  const bounds = { minX: 0, maxX: 5000, minY: 0, maxY: 2100 };
  const previous = fit({ ...bounds, maxY: 2600 });
  const before = new Map([['a', { x: 1000, y: 400 }], ['b', { x: 3000, y: 800 }], ['c', { x: 2000, y: 1200 }]]);
  assert.equal(sharedSyntaxTravel(previous, before, previous, before), 0);
  assert.equal(enterStageCamera(previous, fit(bounds), bounds, view, before, before), previous,
    'unchanged syntax keeps the documented no-zoom-in retention');
  const shift = ({ x, y }) => ({ x: x + 3000, y: y + 1300 });
  const moved = { minX: 3000, maxX: 8000, minY: 1300, maxY: 3400 };
  const after = new Map([...before].map(([id, point]) => [id, shift(point)]));
  assert.deepEqual(enterStageCamera(previous, fit(moved), moved, view, before, after), fit(moved),
    'a retained pose that no longer frames the shared syntax yields to the stage fit');
  assert.deepEqual(enterStageCamera(previous, fit(bounds), bounds, view, before, new Map([['d', { x: 1, y: 1 }]])), fit(bounds),
    'without shared syntax there is nothing for retention to hold still');
});

test('a step into new stage coordinates starts with attached shared syntax where it was painted', () => {
  const painted = { x: 474, y: 60, k: 0.2 };
  const node = (x, y, ...ancestors) => ({ x, y, ancestors });
  const before = new Map([['root', node(1000, 200)], ['head', node(800, 400, 'root')], ['comp', node(1200, 400, 'root')],
    ['moved', node(1400, 600, 'comp', 'root')], ['word', node(1400, 800, 'moved', 'comp', 'root')]]);
  // Stage 2 shifts everything by (+3000, +1500), then reattaches `moved` under a new root.
  const after = new Map([['top', node(3800, 1500)], ['root', node(4000, 1700, 'top')], ['head', node(3800, 1900, 'root', 'top')],
    ['comp', node(4200, 1900, 'root', 'top')], ['moved', node(3600, 1700, 'top')], ['word', node(3600, 1900, 'moved', 'top')]]);
  const view = { left: 0, right: 2000, top: 0, bottom: 2000 };
  const start = stageEntryStartCamera(painted, before, after, view);
  assert.equal(start.k, painted.k);
  for (const id of ['root', 'head', 'comp']) {
    assert.deepEqual([start.x + after.get(id).x * start.k, start.y + after.get(id).y * start.k],
      [painted.x + before.get(id).x * painted.k, painted.y + before.get(id).y * painted.k], `${id} keeps its painted place`);
  }
  assert.notEqual(start.x + after.get('moved').x * start.k, painted.x + before.get('moved').x * painted.k,
    'the reattached constituent is the syntax that visibly moves');
  assert.deepEqual(stageEntryStartCamera(painted, before, before, view), painted, 'unchanged coordinates leave the painted camera');
  assert.deepEqual(stageEntryStartCamera(painted, before, new Map([['new', node(1, 1)]]), view), painted);
  // The painted camera already shows all of stage 2 here; the anchored start would lose it.
  assert.deepEqual(stageEntryStartCamera(painted, before, after, { left: 1000, right: 1400, top: 300, bottom: 500 }), painted,
    'a start never takes shared syntax off the canvas');
});
