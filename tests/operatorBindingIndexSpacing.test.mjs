import assert from 'node:assert/strict';
import test from 'node:test';
import { operatorBindingIndexPoint } from '../replay/relations/markGeometry.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const glyphs = [
  { y: -22, height: 28 }, { y: -31.25, height: 37.75 },
  { y: -9.5, height: 12 }, { y: -48, height: 59 }, { y: 2, height: 7 }
];
const labels = [
  { x: 10, y: 40, width: 18, height: 20 },
  { x: -80, y: -50, width: 275, height: 32 },
  { x: 0.25, y: 310.5, width: 74.5, height: 51.5 }
];
const endpointFor = (rect, role) => rect.y + rect.height * (role === 'operator' ? 0.62 : 0.58);

test('binding indices retain their exact old placement when the path uses the label left side', () => {
  for (const rect of labels) for (const glyph of glyphs) for (const role of ['operator', 'variable']) {
    assert.deepEqual(operatorBindingIndexPoint(rect, glyph, role, -1, 0),
      { x: rect.x + rect.width + 10, y: rect.y + rect.height * 0.72 });
  }
});

test('both right-side indices clear the whole endpoint interval and their painted outlines', () => {
  for (const rect of labels) for (const glyph of glyphs) for (const role of ['operator', 'variable']) {
    const before = structuredClone({ rect, glyph });
    const endpoint = endpointFor(rect, role);
    for (const otherEndpoint of [endpoint - 1000, endpoint, endpoint + 1000]) {
      const point = operatorBindingIndexPoint(rect, glyph, role, 1, otherEndpoint);
      const paintedTextTop = point.y + glyph.y - 3.5;
      const paintedTextBottom = point.y + glyph.y + glyph.height + 3.5;
      if (endpoint < otherEndpoint) {
        assert.ok(paintedTextBottom <= endpoint - 5.0325 - 3.9999, `${role}: upper index crosses the path interval`);
      } else {
        assert.ok(paintedTextTop >= endpoint + 5.0325 + 3.9999, `${role}: lower index crosses the path interval`);
      }
      assert.equal(point.x, rect.x + rect.width + 10, 'horizontal label/index spacing stays unchanged');
    }
    assert.deepEqual({ rect, glyph }, before, 'measured inputs are never changed');
  }
});

test('an already clear right-side index is not moved', () => {
  const rect = { x: 200, y: 70, width: 40, height: 500 };
  for (const role of ['operator', 'variable']) {
    assert.deepEqual(operatorBindingIndexPoint(rect, glyphs[0], role, 1, 0), { x: 250, y: 430 });
  }
});

test('index clearance survives shared zoom and pan without recomputing relative spacing', () => {
  for (const scale of [0.1, 0.25, 0.5, 1, 2, 5]) for (const role of ['operator', 'variable']) {
    const rect = labels[0], glyph = glyphs[0];
    const endpointY = endpointFor(rect, role);
    for (const otherEndpoint of [endpointY - 1000, endpointY, endpointY + 1000]) {
      const point = operatorBindingIndexPoint(rect, glyph, role, 1, otherEndpoint);
      const panY = -190;
      const textTop = (point.y + glyph.y - 3.5) * scale + panY;
      const textBottom = (point.y + glyph.y + glyph.height + 3.5) * scale + panY;
      const linePadding = Math.max(5.0325 * scale, 0.6);
      const lineBottom = Math.max(endpointY, otherEndpoint) * scale + panY + linePadding;
      const lineTop = Math.min(endpointY, otherEndpoint) * scale + panY - linePadding;
      assert.ok(textTop > lineBottom || textBottom < lineTop, `painted overlap at scale ${scale}`);
      assert.ok(Math.abs(point.x * scale - (rect.x + rect.width) * scale - 10 * scale) < 1e-9);
    }
  }
});

test('repeated measured placement is stable and empty glyphs keep their original position', () => {
  const rect = labels[1], glyph = glyphs[1];
  const point = operatorBindingIndexPoint(rect, glyph, 'operator', 1, 0);
  const renderedBaseline = Number(point.y.toFixed(1));
  const measured = { y: renderedBaseline + glyph.y, height: glyph.height };
  assert.deepEqual(operatorBindingIndexPoint(rect,
    { y: measured.y - renderedBaseline, height: measured.height }, 'operator', 1, 0), point);
  assert.deepEqual(operatorBindingIndexPoint(rect, { y: 0, height: 0 }, 'operator', 1, 0),
    { x: rect.x + rect.width + 10, y: rect.y + rect.height * 0.72 });
});

test('steep aligned binding paths cannot cross either index, including reversed endpoint heights', () => {
  const glyph = { y: -22, height: 28 };
  for (const [operatorY, variableY] of [[0, 1000], [1000, 0], [0, 0.8]]) {
    const rects = { operator: { x: 0, y: operatorY, width: 20, height: 20 },
      variable: { x: 0, y: variableY, width: 20, height: 20 } };
    const fromY = endpointFor(rects.variable, 'variable'), toY = endpointFor(rects.operator, 'operator');
    for (const role of ['operator', 'variable']) {
      const point = operatorBindingIndexPoint(rects[role], glyph, role, 1, role === 'operator' ? fromY : toY);
      const top = point.y + glyph.y - 3.5, bottom = point.y + glyph.y + glyph.height + 3.5;
      for (let step = 0; step <= 500; step++) {
        const t = step / 500;
        const pathY = (1 - t) ** 3 * fromY + 3 * (1 - t) ** 2 * t * fromY
          + 3 * (1 - t) * t ** 2 * toY + t ** 3 * toY;
        assert.ok(pathY + 5.0325 < top || pathY - 5.0325 > bottom,
          `${role} crosses steep/horizontal curve at t=${t}`);
      }
    }
  }
});

test('Orchard-style exact binding and recovered binding retain the same path, domain, and index primitive', () => {
  const forest = [{ id: 'root', label: 'CP', children: [
    { id: 'operator', label: 'DP', children: [{ id: 'who', label: 'D', word: 'Who' }] },
    { id: 'domain', label: 'TP', children: [
      { id: 'variable', label: 'DP', silent: true }, { id: 'verb', label: 'V', word: 'left' }
    ] }
  ] }];
  const draw = relation => compileRelationRenderPlan([{ statement: '', stageRecord: '', workspaceForest: forest,
    relations: [{ relation, anchors: { operator: 'operator', variable: 'variable', scopeDomain: 'domain' } }] }])
    .frames[0].items.filter(item => item.kind === 'operator-variable-binding');
  const exact = draw('OperatorVariableBinding'), recovered = draw('relative operator-variable binding');
  assert.equal(exact.length, 1); assert.equal(recovered.length, 1);
  const shape = ({ kind, operatorNodeId, variableNodeId, scopeDomainNodeId, index }) =>
    ({ kind, operatorNodeId, variableNodeId, scopeDomainNodeId, index });
  assert.deepEqual(shape(exact[0]), shape(recovered[0]));
  assert.equal(exact[0].index, 'i');
  assert.equal(recovered[0].tier2FacetId, 'operator-binding');
});
