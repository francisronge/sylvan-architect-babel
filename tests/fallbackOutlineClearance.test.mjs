import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame, fitFallbackGeometry } from '../replay/relations/geometryBinding.ts';
import { fongEdgeOutlineRect } from '../replay/relations/markGeometry.ts';

test('neutral labels clear their phase-edge outline at Fit and zoom without changing other witnesses', () => {
  const stage = relations => ({ statement: '', stageRecord: '', relations,
    workspaceForest: [{ id: 'edge', label: 'D' }, { id: 'other', label: 'T' }] });
  const context = { relation: 'authored context', anchors: { higherOccurrence: 'edge', otherContext: 'other' } };
  const edge = { relation: 'edge accessibility', anchors: { phaseEdge: 'edge' } };
  const labels = { edge: { x: 0, y: 0, width: 350, height: 112 }, other: { x: 1200, y: 0, width: 30, height: 25 } };
  const fallbackMeasurements = { labels: Object.values(labels), labelFor: id => labels[id], subtreeFor: id => labels[id], bottom: 112 };
  const bind = relations => bindRelationPlanFrame(compileRelationRenderPlan([stage(relations)]), 0,
    id => ({ x: labels[id].x + labels[id].width / 2, y: labels[id].y + labels[id].height / 2 }),
    { fallbackMeasurements, separateFallbackMoments: true });
  const before = bind([context]), after = bind([edge, context]), box = fongEdgeOutlineRect(labels.edge);
  const mark = frame => frame.primitives.find(item => item.type === 'fallback-mark' && item.nodeId === 'edge');
  const intersects = (item, scale) => item.x - (item.textWidth / 2 + 4) * scale < box.x + box.width
    && item.x + (item.textWidth / 2 + 4) * scale > box.x
    && item.y - 12 * scale < box.y + box.height && item.y + 12 * scale > box.y;
  assert(intersects(mark(before), 1), 'reproduce the outline crossing');
  const snapshot = structuredClone(after);
  for (const scale of [0.25, 0.5, 1, 3]) {
    const fit = frame => fitFallbackGeometry(frame, { fallbackMeasurements, fittedMarkerScale: scale, separateFallbackMoments: true });
    assert(!intersects(fit(after).get(mark(after)), scale));
    const other = frame => frame.primitives.find(item => item.type === 'fallback-mark' && item.nodeId === 'other');
    const plain = fit(before).get(other(before)), unchanged = fit(after).get(other(after));
    assert.deepEqual([unchanged.x, unchanged.y], [plain.x, plain.y]);
  }
  assert.deepEqual(after, snapshot);
});
