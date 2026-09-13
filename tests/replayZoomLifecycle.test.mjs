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

test('an active wheel gesture uses the new Replay frame handler after redraw', async () => {
  let memo;
  const useMemo = create => memo ??= create();
  const createBehavior = () => new Function('d3', 'useMemo', initializer('zoomBehavior'))(d3, useMemo);
  const listeners = new Map();
  const svg = { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name),
    getBoundingClientRect: () => ({ left: 0, top: 0 }), clientLeft: 0, clientTop: 0 };
  const camera = { current: null };
  const bind = group => {
    const behavior = createBehavior().extent([[0, 0], [1000, 800]]).touchable(false);
    return new Function('zoomBehavior', 'g', 'manualCameraRef', 'data', 'derivationStagesSignature', 'containerWidth', 'containerHeight', 'updateScreenStableText', initializer('zoom'))(
      behavior, group, camera, 'same analysis', 'same stages', 1000, 800, () => {});
  };
  const group = () => ({ transform: null, attr(_name, value) { this.transform = value; return this; }, selectAll() { return { attr() {} }; } });
  const first = group(), next = group();
  const firstBehavior = bind(first);
  d3.select(svg).call(firstBehavior);
  const ended = new Promise(resolve => firstBehavior.on('end.test', resolve));
  listeners.get('wheel').call(svg, { type: 'wheel', deltaY: -100, deltaMode: 0, clientX: 200, clientY: 200, preventDefault() {}, stopImmediatePropagation() {} });
  const before = first.transform;
  assert(before.k > 1);
  const nextBehavior = bind(next);
  assert.equal(nextBehavior, firstBehavior, 'the gesture dispatcher belongs to the SVG, not a frame');
  d3.select(svg).call(nextBehavior).call(nextBehavior.transform, before);
  assert.deepEqual(next.transform, before);
  const later = before.translate(10, 20);
  d3.select(svg).call(nextBehavior.transform, later);
  assert.deepEqual(next.transform, later);
  assert.deepEqual(first.transform, before, 'the detached frame must not receive later camera updates');
  assert.deepEqual(camera.current.transform, later);
  await ended;
});
