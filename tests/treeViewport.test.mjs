import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceFittedCamera, availableTreeViewport, carryCamera, containCamera, createViewportSettler, linearizationViewport,
  VIEWPORT_SETTLE_MS
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

function settlerHarness() {
  const timers = new Map(), applied = [];
  let now = 0, id = 0, painted = false;
  const settler = createViewportSettler({
    apply: size => applied.push({ ...size, at: now }), painted: () => painted,
    schedule: (callback, delay) => { timers.set(++id, { callback, at: now + delay }); return id; },
    cancel: timer => timers.delete(timer)
  });
  const advance = ms => {
    now += ms;
    for (const [timer, { callback, at }] of [...timers]) if (at <= now) { timers.delete(timer); callback(); }
  };
  return { settler, applied, timers, advance, paint: () => { painted = true; } };
}

test('opening sizes apply at once, so the first paint is never delayed', () => {
  const { settler, applied, timers, paint } = settlerHarness();
  settler.observe({ width: 1200, height: 750 });
  settler.observe({ width: 1200, height: 750 });
  settler.observe({ width: 1196, height: 750 });
  assert.deepEqual(applied, [{ width: 1200, height: 750, at: 0 }, { width: 1196, height: 750, at: 0 }]);
  assert.equal(timers.size, 0);
  paint();
  settler.observe({ width: 1196, height: 750 });
  assert.equal(settler.pending, false, 'an unchanged size after painting schedules nothing');
});

test('a resize burst after painting applies its last size once, after it settles', () => {
  const { settler, applied, advance, paint } = settlerHarness();
  settler.observe({ width: 1200, height: 750 }); paint();
  settler.observe({ width: 1400, height: 860 });
  advance(VIEWPORT_SETTLE_MS - 1);
  settler.observe({ width: 1600, height: 1000 });
  assert(settler.pending);
  advance(VIEWPORT_SETTLE_MS - 1);
  assert.equal(applied.length, 1, 'the painted frame stays in place while the canvas keeps changing');
  advance(1);
  assert.deepEqual(applied.at(-1), { width: 1600, height: 1000, at: 2 * VIEWPORT_SETTLE_MS - 1 });
  assert.equal(settler.pending, false);
  settler.observe({ width: 1200, height: 750 });
  settler.observe({ width: 1600, height: 1000 });
  advance(VIEWPORT_SETTLE_MS);
  assert.equal(applied.length, 3, 'a burst that returns to the committed size still settles, so a refit clears its pending state');
  assert.deepEqual(applied.at(-1), { width: 1600, height: 1000, at: 3 * VIEWPORT_SETTLE_MS - 1 });
  settler.observe({ width: 900, height: 700 }); settler.dispose();
  advance(VIEWPORT_SETTLE_MS);
  assert.equal(applied.length, 3, 'unmounting cancels an unsettled resize');
});

test('a stage crossing carries the camera with unmoved shared syntax, not the reattached constituent', () => {
  const pose = { x: 474, y: 60, k: 0.2 };
  const node = (x, y, parentId = null) => ({ x, y, parentId });
  const before = new Map([['root', node(1000, 200)], ['head', node(800, 400, 'root')], ['comp', node(1200, 400, 'root')],
    ['moved', node(1400, 600, 'comp')], ['word', node(1400, 800, 'moved')]]);
  // Stage 2 shifts everything by (+3000, +1500), then reattaches `moved` under a new root.
  const after = new Map([['top', node(3800, 1500)], ['root', node(4000, 1700, 'top')], ['head', node(3800, 1900, 'root')],
    ['comp', node(4200, 1900, 'root')], ['moved', node(3600, 1700, 'top')], ['word', node(3600, 1900, 'moved')]]);
  const carried = carryCamera(pose, before, after);
  const screen = (camera, { x, y }) => [camera.x + x * camera.k, camera.y + y * camera.k];
  assert.equal(carried.k, pose.k);
  for (const id of ['root', 'head', 'comp']) {
    assert.deepEqual(screen(carried, after.get(id)), screen(pose, before.get(id)), `${id} keeps its place on screen`);
  }
  assert.notDeepEqual(screen(carried, after.get('moved')), screen(pose, before.get('moved')),
    'the reattached constituent is the syntax that visibly moves');
  assert.deepEqual(carryCamera(pose, before, before), pose, 'unchanged coordinates leave the pose');
  assert.deepEqual(carryCamera(pose, before, new Map([['new', node(1, 1)]])), pose, 'nothing shared leaves the pose');
});
