import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import ts from 'typescript';
import { availableTreeViewport } from '../components/treeViewport.ts';
import { buildStageCameraBounds, buildStagePlaqueLayout, stageTreeLayoutSize, treeLayoutSize } from '../replay/stageCamera.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { applyVizIds, buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));
const renderer = ts.createSourceFile('TreeVisualizer.tsx', fs.readFileSync(new URL('../components/TreeVisualizer.tsx', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fitFunction;
let treeLayoutFunction;
const findFit = node => {
  if (ts.isVariableDeclaration(node) && node.name.getText(renderer) === 'fitToRenderedBounds') fitFunction = node.initializer;
  if (ts.isVariableDeclaration(node) && node.name.getText(renderer) === 'treeLayout') treeLayoutFunction = node.initializer;
  ts.forEachChild(node, findFit);
};
findFit(renderer);
assert(fitFunction, 'test must execute the actual production camera fit');
assert(treeLayoutFunction, 'test must execute the actual production tree layout');
const productionTreeLayout = (canvas, width, height, stageSize = null) => {
  const root = d3.hierarchy(canvas);
  applyVizIds(root);
  const [innerWidth, innerHeight] = stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height);
  const layout = new Function('d3', 'innerWidth', 'innerHeight', ts.transpile(`return ${treeLayoutFunction.getText(renderer)};`,
    { target: ts.ScriptTarget.ES2023 }))(d3, innerWidth, innerHeight);
  return layout(root);
};

test('Astra did subtree retains identical coordinates on entry to Wh-Agree', () => {
  const record = records.find(record => record.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const before = steps.find(step => step.replayFrameIndex === 5 && step.replayKind === 'macro');
  const after = steps.find(step => step.replayRelationIdentity?.stageIndex === 6
    && step.replayRelationIdentity.relationIndex === 0);
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    const coordinates = step => productionTreeLayout(step.replayCanvasData, width, height,
      stageTreeLayoutSize(steps, step.replayFrameIndex, width, height)).descendants()
      .filter(node => ['complexC', 'raisedT', 'raisedT::__leaf', 'questionC'].includes(node.__vizId ?? node.data.id))
      .map(node => ({ id: node.__vizId ?? node.data.id, x: node.x, y: node.y }));
    const original = coordinates(before);
    assert.equal(original.length, 4, 'test must include the head, its two children, and did');
    assert.deepEqual(coordinates(after), original, 'new relation badges cannot spread an unchanged subtree');
  }
});

for (const record of records) {
  const plan = compileRelationRenderPlan(record.derivationStages);
  if (!plan.frames.some(frame => frame.items.some(item => item.kind === 'fallback' && item.drawing.marks.length > 1))) continue;
  test(`${record.name}: saved fallback badge circles remain distinct with ordinary tree spacing`, () => {
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    let checked = 0;
    for (const step of steps) {
      const tree = productionTreeLayout(step.replayCanvasData, 1596, 1016,
        stageTreeLayoutSize(steps, step.replayFrameIndex, 1596, 1016));
      const byId = new Map(tree.descendants().map(node => [node.__vizId ?? node.data.id, node]));
      for (const markerScale of [1, 3]) {
        const bound = bindRelationPlanFrame(plan, step.replayFrameIndex, id => byId.get(id) ?? null,
          { labelWidth: 150, labelHeight: 70, badgeGap: 46, markerScale });
        const badges = bound.primitives.filter(mark => mark.type === 'fallback-mark');
        for (let i = 0; i < badges.length; i++) for (let j = i + 1; j < badges.length; j++) {
          assert(Math.hypot(badges[i].x - badges[j].x, badges[i].y - badges[j].y) >= 20 * markerScale,
            `stage ${step.replayFrameIndex + 1}: fallback circles collide at ${badges[i].nodeId}/${badges[j].nodeId}`);
          checked++;
        }
      }
    }
    assert(checked > 0, 'fixture must exercise multiple fallback marks');
  });
}
const fit = (bounds, viewport, width) => {
  let result;
  const dependencies = { d3, stageCameraBounds: bounds, derivationFrameFitNodes: [{}], overlayFitBounds: null,
    fitLeft: viewport.left, fitRight: viewport.right, fitTop: viewport.top, fitBottom: viewport.bottom,
    minimumInitialScale: width < 500 ? 0.02 : 0.06, applyFittedCamera: transform => { result = transform; } };
  const run = new Function(...Object.keys(dependencies), ts.transpile(`return (${fitFunction.getText(renderer)})();`,
    { target: ts.ScriptTarget.ES2023 }));
  assert.equal(run(...Object.values(dependencies)), true);
  return result;
};
for (const record of records) {
  for (const [width, height] of [[1596, 1016], [386, 698]]) {
    test(`${record.name} ${width}px: stage fit contains all revealed syntax and is independent of traversal order`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const original = JSON.stringify(steps);
      const plan = compileRelationRenderPlan(record.derivationStages);
      record.derivationStages.forEach((stage, stageIndex) => {
        const input = { steps, stageIndex, plan, width, height,
          completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
        const bounds = buildStageCameraBounds(input);
        assert(bounds);
        assert(Object.values(bounds).every(Number.isFinite));
        assert.deepEqual(buildStageCameraBounds({ ...input, steps: [...steps].reverse() }), bounds);
        const stageSteps = steps.filter(step => step.replayFrameIndex === stageIndex);
        // Plaques carry their reserved offsets from earlier stages. With those
        // supplied, camera fitting must still use only the current stage's syntax.
        const plaqueLayout = buildStagePlaqueLayout(input);
        assert.deepEqual(buildStageCameraBounds({ ...input, steps: stageSteps, plaqueLayout }), bounds,
          'other stages must not affect this stage fit when plaque positions are fixed');
        const viewport = availableTreeViewport(width, height, { headerBottom: 100, panelTop: height - 230 });
        const camera = fit(bounds, viewport, width);
        for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) {
          const [screenX, screenY] = camera.apply([x, y]);
          assert(screenX >= viewport.left && screenX <= viewport.right, 'production fit must stay inside horizontal viewport');
          assert(screenY >= viewport.top && screenY <= viewport.bottom, 'production fit must avoid header and Replay controls');
        }
        for (const step of stageSteps) {
          const root = d3.hierarchy(step.replayCanvasData);
          applyVizIds(root);
          const tree = d3.tree().size(stageTreeLayoutSize(steps, stageIndex, width, height))
            .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
          const visibleIds = new Set(step.replayVisibleNodeIds);
          for (const node of tree.descendants()) {
            if (node.data.label === '__DERIVATION_WORKSPACE__' || !visibleIds.has(node.__vizId ?? node.data.id)) continue;
            assert(node.x >= bounds.minX && node.x <= bounds.maxX, `${step.targetLabel}: x outside fit`);
            assert(node.y >= bounds.minY && node.y <= bounds.maxY, `${step.targetLabel}: y outside fit`);
          }
        }
      });
      assert.equal(JSON.stringify(steps), original, 'camera measurement must not change Replay');
    });
  }
}

test('Fable source words disappearing cannot shrink the fit halfway through wh movement', () => {
  const record = records.find(item => item.name === 'fable-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const stageIndex = 4;
  const input = { steps, stageIndex, completedCanvas: steps.at(-1).replayCanvasData,
    plan: null, width: 1596, height: 1016 };
  const before = steps.find(step => step.replayFrameIndex === stageIndex);
  const after = steps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex
    && step.replayRelationIdentity.relationIndex === 1);
  assert.equal(before.replayUsesFutureLayoutScaffold, true);
  assert.equal(after.replayUsesFutureLayoutScaffold, false);
  const all = buildStageCameraBounds(input);
  const size = stageTreeLayoutSize(steps, stageIndex, input.width, input.height);
  for (const step of [before, after]) {
    const visible = new Set(step.replayVisibleNodeIds);
    const tree = productionTreeLayout(step.replayCanvasData, input.width, input.height, size);
    for (const node of tree.descendants()) {
      if (node.data.label === '__DERIVATION_WORKSPACE__' || !visible.has(node.__vizId ?? node.data.id)) continue;
      assert(node.x >= all.minX && node.x <= all.maxX);
      assert(node.y >= all.minY && node.y + (node.children?.length ? 0 : 130) <= all.maxY);
    }
  }
});

test('hidden-overlay mode excludes plaque extents while retaining ordinary tree layout', () => {
  const record = records.find(item => item.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const input = { steps, stageIndex: 6, completedCanvas: steps.at(-1).replayCanvasData,
    plan: compileRelationRenderPlan(record.derivationStages), width: 386, height: 698 };
  const hidden = buildStageCameraBounds({ ...input, includeOverlays: false });
  const shown = buildStageCameraBounds(input);
  assert.deepEqual(hidden,
    buildStageCameraBounds({ ...input, includeOverlays: false, plaqueLayout: new Map() }));
  assert.deepEqual(hidden,
    buildStageCameraBounds({ ...input, includeOverlays: false, plaqueLayout: buildStagePlaqueLayout(input) }),
    'passing a precomputed plaque layout cannot override the tree-only fit policy');
  assert(hidden.maxY < shown.maxY, 'hidden plaques must not consume space below the tree');
});

for (const record of records) {
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    test(`${record.name} ${width}px: first-stage fit excludes invisible future branches`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const plan = compileRelationRenderPlan(record.derivationStages);
      const visible = [];
      const all = [];
      for (const step of steps.filter(step => step.replayFrameIndex === 0)) {
        const root = d3.hierarchy(step.replayCanvasData);
        applyVizIds(root);
        const tree = d3.tree().size(stageTreeLayoutSize(steps, 0, width, height))
          .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
        const ids = new Set(step.replayVisibleNodeIds);
        all.push(...tree.descendants().filter(node => node.data.label !== '__DERIVATION_WORKSPACE__'));
        visible.push(...tree.descendants().filter(node => ids.has(node.__vizId ?? node.data.id)
          && node.data.label !== '__DERIVATION_WORKSPACE__'));
      }
      assert(d3.min(all, node => node.x) < d3.min(visible, node => node.x), 'fixture must contain hidden layout to the left');
      const bounds = buildStageCameraBounds({ steps, stageIndex: 0, plan, width, height, includeOverlays: false,
        completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[0].workspaceForest) });
      assert.deepEqual(bounds, {
        minX: d3.min(visible, node => node.x), maxX: d3.max(visible, node => node.x),
        minY: d3.min(visible, node => node.y), maxY: d3.max(visible, node => node.y + (node.children?.length ? 0 : 130))
      });
      const viewport = availableTreeViewport(width, height, { headerBottom: 100, panelTop: height - 230 });
      const camera = fit(bounds, viewport, width);
      const midpoint = camera.apply([(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2]);
      assert(Math.abs(midpoint[0] - (viewport.left + viewport.right) / 2) < 1e-8);
      assert(Math.abs(midpoint[1] - (viewport.top + viewport.bottom) / 2) < 1e-8);
    });
  }
}

test('Astra do-support reveals did without spreading existing syntax', () => {
  const record = records.find(item => item.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const before = steps[28];
  const after = steps[29];
  assert.equal(before.replayFrameIndex, after.replayFrameIndex);
  assert.equal(d3.hierarchy(after.replayCanvasData).descendants().length,
    d3.hierarchy(before.replayCanvasData).descendants().length + 1);
  const original = JSON.stringify(steps);
  for (const [width, height] of [[1596, 1016], [386, 698]]) {
    const size = stageTreeLayoutSize(steps, before.replayFrameIndex, width, height);
    const oldTree = productionTreeLayout(before.replayCanvasData, width, height, size);
    const newTree = productionTreeLayout(after.replayCanvasData, width, height, size);
    const byId = new Map(newTree.descendants().map(node => [node.data.id, node]));
    for (const node of oldTree.descendants()) {
      const next = byId.get(node.data.id);
      assert(next, `${node.data.id} must survive do-support`);
      assert.equal(next.x, node.x, `${node.data.id} must not shift horizontally`);
      assert.equal(next.y, node.y, `${node.data.id} must not shift vertically`);
    }
    assert.equal(oldTree.descendants().some(node => node.data.id === 'raisedT::__leaf'), false);
    assert(byId.has('raisedT::__leaf'), 'did must still appear only at do-support');
    assert.deepEqual(stageTreeLayoutSize([...steps].reverse(), before.replayFrameIndex, width, height), size);
    assert.deepEqual(stageTreeLayoutSize(steps.filter(step => step.replayFrameIndex === before.replayFrameIndex),
      before.replayFrameIndex, width, height), size, 'other stages cannot change the budget');
  }
  assert.equal(JSON.stringify(steps), original, 'reserving dimensions must not rewrite Replay or reveal masks');
});

test('stage dimensions reserve both width and height and tolerate a stage without Replay', () => {
  const shallow = { id: 'p', label: 'P', children: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
  const deep = { id: 'p', label: 'P', children: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B',
    children: [{ id: 'c', label: 'C' }] }] }] };
  const steps = [shallow, deep].map(replayCanvasData => ({ replayFrameIndex: 0, replayCanvasData }));
  assert.deepEqual(stageTreeLayoutSize(steps, 0, 100, 100), treeLayoutSize(4, 3, 100, 100));
  assert.equal(stageTreeLayoutSize(steps, 1, 100, 100), null);
});
