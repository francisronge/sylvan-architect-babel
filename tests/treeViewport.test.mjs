import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTreeViewport, linearizationViewport } from '../components/treeViewport.ts';

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
