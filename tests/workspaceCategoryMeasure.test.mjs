import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { categoryTextLayout } from '../replay/categoryTextLayout.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { plaqueTreeObstacles } from '../replay/relations/plaquePlacement.ts';

function forest() {
  const canvas = { id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children: [
    { id: 'left', label: 'D (strong, nominative, masculine, plural)' },
    { id: 'right', label: 'T (past, finite, agreement)' }
  ] };
  return { canvas, steps: [{ replayFrameIndex: 0, replayStageStepIndex: 0,
    replayKind: 'macro', operation: 'Stage', replayCanvasData: canvas,
    replayVisibleNodeIds: ['left', 'right'] }] };
}

for (const direction of ['ltr', 'rtl']) test(`${direction}: planner uses the painter measurement and invalidates settled-font geometry`, () => {
  const { canvas, steps } = forest(), saved = JSON.stringify(steps), size = [500, 500];
  let conservativeCalls = 0, settledCalls = 0;
  const conservative = text => { conservativeCalls++; return [...text].length * 25; };
  const settled = text => { settledCalls++; return [...text].length * 10; };
  assert.notEqual(categoryTextLayout(canvas.children[0].label, conservative).lines.length,
    categoryTextLayout(canvas.children[0].label, settled).lines.length);
  const plan = measure => buildStageCoordinateReservations(steps, 0, size, () => size, direction, measure).get(canvas);
  const before = plan(conservative), after = plan(settled);
  assert.notDeepEqual(after, before, 'changed wrapping must update reserved clearance');
  const calls = settledCalls;
  assert.deepEqual(plan(settled), after);
  assert.equal(settledCalls, calls, 'the same settled font reuses its cached geometry');
  assert.deepEqual(plan(conservative), before, 'font-specific plans cannot contaminate one another');
  assert.deepEqual(plan(undefined), before, 'Node callers preserve the existing fallback');
  assert(conservativeCalls && settledCalls);

  const root = d3.hierarchy(canvas); applyVizIds(root);
  const tree = layoutSyntaxTree(root, size, direction, after, new Set(['left', 'right']));
  const [left, right] = tree.children.map(node => plaqueTreeObstacles([node], settled));
  for (const a of left) for (const b of right) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    assert(overlapX <= 0 || overlapY <= 0, 'the painter-sized category rectangles remain clear');
  }
  assert.equal(JSON.stringify(steps), saved);
});
