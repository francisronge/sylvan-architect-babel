import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTreeViewport, containCamera, linearizationViewport } from '../components/treeViewport.ts';

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
