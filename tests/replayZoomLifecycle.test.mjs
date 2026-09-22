import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as d3 from 'd3';

const source = ts.createSourceFile('TreeVisualizer.tsx', readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializer = name => {
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(expression, `production ${name} must exist`);
  return ts.transpile(`return (${expression.getText(source)});`, { target: ts.ScriptTarget.ES2023 });
};

const setup = () => {
  let memo;
  const useMemo = create => memo ??= create();
  const createBehavior = () => new Function('d3', 'useMemo', initializer('zoomBehavior'))(d3, useMemo);
  const listeners = new Map();
  const svg = { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name),
    getBoundingClientRect: () => ({ left: 0, top: 0 }), clientLeft: 0, clientTop: 0 };
  const camera = { current: null };
  const effects = { revealsFinished: 0, lightRefreshes: 0 };
  const bind = group => {
    const behavior = createBehavior().extent([[0, 0], [1000, 800]]).touchable(false);
    return new Function('zoomBehavior', 'g', 'manualCameraRef', 'data', 'derivationStagesSignature', 'containerWidth', 'containerHeight', 'updateScreenStableText', 'svg', 'effects', `
      let applyingCameraTransform = false;
      let refreshTrajectoryClearance = null;
      const finishCollectionReveal = () => effects.revealsFinished++;
      const refreshIdentityForestLight = () => effects.lightRefreshes++;
      const zoom = (() => { ${initializer('zoom')} })();
      const applyCameraTransform = (() => { ${initializer('applyCameraTransform')} })();
      return { zoom, applyCameraTransform };
    `)(behavior, group, camera, 'same analysis', 'same stages', 1000, 800, () => {}, d3.select(svg), effects);
  };
  const group = () => ({ transform: null, attr(_name, value) { this.transform = value; return this; }, selectAll() { return { attr() {} }; } });
  const wheel = () => listeners.get('wheel').call(svg, { type: 'wheel', deltaY: -100, deltaMode: 0, clientX: 200, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
  return { svg, camera, bind, group, wheel, effects };
};

test('an active wheel gesture uses the new Replay frame handler after redraw', async () => {
  const { svg, camera, bind, group, wheel, effects } = setup();
  const first = group(), next = group();
  const { zoom: firstBehavior } = bind(first);
  d3.select(svg).call(firstBehavior);
  const ended = new Promise(resolve => firstBehavior.on('end.test', resolve));
  wheel();
  assert.equal(effects.revealsFinished, 1, 'manual zoom finishes an in-flight collector reveal');
  assert.equal(effects.lightRefreshes, 1, 'manual zoom invalidates static lighting');
  const before = first.transform;
  assert(before.k > 1);
  const { zoom: nextBehavior, applyCameraTransform } = bind(next);
  assert.equal(nextBehavior, firstBehavior, 'the gesture dispatcher belongs to the SVG, not a frame');
  d3.select(svg).call(nextBehavior);
  applyCameraTransform(before);
  assert.equal(effects.revealsFinished, 1, 'automatic fitting must not end the reveal');
  assert.equal(effects.lightRefreshes, 2, 'automatic fitting also updates light positions');
  assert.deepEqual(next.transform, before);
  const later = before.translate(10, 20);
  applyCameraTransform(later);
  assert.deepEqual(next.transform, later);
  assert.deepEqual(first.transform, before, 'the detached frame must not receive later camera updates');
  assert.deepEqual(camera.current.transform, before, 'programmatic updates must not become manual input');
  await ended;
});

for (const active of [true, false]) {
  test(`Fit restores automatic camera mode with a ${active ? 'live' : 'finished'} wheel gesture`, async () => {
    const { svg, camera, bind, group, wheel } = setup();
    const current = group();
    const { zoom, applyCameraTransform } = bind(current);
    d3.select(svg).call(zoom);
    const ended = new Promise(resolve => zoom.on('end.test', resolve));
    wheel();
    assert(camera.current);
    if (!active) await ended;
    camera.current = null; // Fit button
    const fitted = d3.zoomIdentity.translate(30, 40).scale(0.3);
    applyCameraTransform(fitted);
    assert.deepEqual(current.transform, fitted);
    assert.equal(camera.current, null, 'Fit must leave automatic framing enabled');
    const next = group();
    const nextFrame = bind(next);
    d3.select(svg).call(nextFrame.zoom);
    const nextFit = d3.zoomIdentity.translate(50, 60).scale(0.4);
    nextFrame.applyCameraTransform(nextFit);
    assert.deepEqual(next.transform, nextFit);
    assert.equal(camera.current, null);
    wheel();
    assert(camera.current, 'later manual input must still take control');
    await new Promise(resolve => zoom.on('end.test', resolve));
  });
}
