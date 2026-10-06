import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { treeInkObstacles } from '../replay/treeInkGeometry.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import ts from 'typescript';
import { availableTreeViewport } from '../components/treeViewport.ts';
import { STAGE_CAMERA_PADDING, buildStageCameraBounds, buildStagePlaqueLayout, stageTreeLayoutSize, treeLayoutSize } from '../replay/stageCamera.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';
import { applyVizIds, buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));

for (const [width, height] of [[1596, 1016], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: future plaque anchors cannot enlarge the opening camera from hidden positions`, () => {
    const canvas = { id: 'root', label: 'XP', children: [
      { id: 'current', label: 'N', word: 'current' }, { id: 'future', label: 'V', word: 'future' }
    ] };
    const opening = structuredClone(canvas), completed = structuredClone(canvas);
    const steps = [
      { replayCanvasData: opening, replayFrameIndex: 0, replayStageStepIndex: 0,
        replayKind: 'micro', replayVisibleNodeIds: ['current'] },
      { replayCanvasData: completed, replayFrameIndex: 0, replayStageStepIndex: 1,
        replayKind: 'macro', replayVisibleNodeIds: ['root', 'current', 'future'] }
    ];
    const points = hidden => new Map([
      ['root', { x: 400, y: 200 }], ['current', { x: 300, y: 400 }],
      ['future', hidden ? { x: -10000, y: -10000 } : { x: 500, y: 400 }]
    ]);
    const coordinates = new Map([[0, new Map([[opening, points(true)], [completed, points(false)]])]]);
    const size = stageTreeLayoutSize(steps, 0, width, height);
    const anchorX = direction === 'rtl' ? size[0] - 500 : 500;
    const box = { x: anchorX + 250, y: 500, width: 300, height: 100, location: 'local',
      domainId: 'root', attachmentNodeId: 'future', attachmentX: anchorX, attachmentY: 400 };
    const placements = new Map([[0, box]]);
    const input = { steps, stageIndex: 0, completedCanvas: completed, plan: null, width, height, direction,
      coordinates, includeOverlays: false, includePlaques: true };
    const original = structuredClone(coordinates);
    for (const layout of [{ plaqueLayout: placements },
      { plaqueSchedule: { stages: [placements], steps: new Map([[0, placements], [1, placements]]) } }]) {
      const configured = { ...input, ...layout };
      assert.deepEqual(buildStageCameraBounds({ ...configured, stepIndex: 0 }),
        buildStageCameraBounds({ ...configured, stepIndex: 0, includePlaques: false }),
        'a plaque cannot contribute a position while its attachment is hidden');
      const wholeStage = buildStageCameraBounds(configured);
      assert.deepEqual(wholeStage, buildStageCameraBounds({ ...configured, stepIndex: 1 }),
        'the opening fit still reserves the later visible plaque at its real position');
      assert(wholeStage.minX <= box.x - 24 && wholeStage.maxX >= box.x + box.width + 24);
      assert(wholeStage.minY <= box.y - 24 && wholeStage.maxY >= box.y + box.height + 24);
      assert.deepEqual(buildStageCameraBounds({ ...configured, steps: [...steps].reverse() }), wholeStage,
        'rewinding cannot change the shared stage fit');
    }
    assert.deepEqual(coordinates, original, 'camera fitting does not move syntax');
  });
}

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
const productionTreeLayout = (canvas, width, height, stageSize = null, steps = []) => {
  const root = d3.hierarchy(canvas);
  applyVizIds(root);
  const [innerWidth, innerHeight] = stageSize ?? treeLayoutSize(root.descendants().length, root.height, width, height);
  const current = steps.find(step => step.replayCanvasData === canvas);
  const reserved = current ? buildStageCoordinateReservations(steps, current.replayFrameIndex, [innerWidth, innerHeight],
    index => stageTreeLayoutSize(steps, index, width, height)).get(canvas) : undefined;
  const layout = new Function('layoutSyntaxTree', 'treeDirection', 'innerWidth', 'innerHeight', 'stageCoordinates', 'replayVisibleNodeIdSet', ts.transpile(`return ${treeLayoutFunction.getText(renderer)};`,
    { target: ts.ScriptTarget.ES2023 }))(layoutSyntaxTree, 'ltr', innerWidth, innerHeight, reserved,
      current?.replayVisibleNodeIds ? new Set(current.replayVisibleNodeIds) : undefined);
  return layout(root);
};

test('Astra did subtree remains stationary throughout the authored Wh-Agree stage', () => {
  const record = records.find(record => record.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const before = steps.find(step => step.replayFrameIndex === 5 && step.replayKind === 'macro');
  const after = steps.find(step => step.replayRelationIdentity?.stageIndex === 6
    && step.replayRelationIdentity.relationIndex === 0);
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    const coordinates = step => productionTreeLayout(step.replayCanvasData, width, height,
      stageTreeLayoutSize(steps, step.replayFrameIndex, width, height), steps).descendants()
      .filter(node => ['complexC', 'raisedT', 'raisedT::__leaf', 'questionC'].includes(node.__vizId ?? node.data.id))
      .map(node => ({ id: node.__vizId ?? node.data.id, x: node.x, y: node.y }));
    const original = coordinates(before), current = coordinates(after);
    assert.equal(current.length, 4, 'test must include the head, its two children, and did');
    for (const step of steps.filter(step => step.replayFrameIndex === 6)) {
      const actual = coordinates(step);
      assert.deepEqual(actual.map(point => point.id), current.map(point => point.id),
        'later frames preserve every subtree identity and its order');
      for (let index = 0; index < current.length; index++) {
        assert(Math.abs(actual[index].x - current[index].x) <= 1e-8, `${current[index].id} remains stationary horizontally`);
        assert(Math.abs(actual[index].y - current[index].y) <= 1e-8, `${current[index].id} remains stationary vertically`);
      }
      const tree = productionTreeLayout(step.replayCanvasData, width, height,
        stageTreeLayoutSize(steps, 6, width, height), steps);
      const visible = new Set(step.replayVisibleNodeIds);
      for (const node of tree.descendants().filter(node => visible.has(node.__vizId ?? node.data.id))) {
        if (node.parent && visible.has(node.parent.__vizId ?? node.parent.data.id)) assert(node.y > node.parent.y);
        const children = (node.children ?? []).filter(child => visible.has(child.__vizId ?? child.data.id));
        for (let index = 1; index < children.length; index++) assert(children[index - 1].x < children[index].x);
      }
    }
    // This new authored stage reserves its later Wh landing before the first
    // relation. Its fit can differ from the preceding stage; Replay within it cannot.
    const bounds = buildStageCameraBounds({ steps, stageIndex: 6, width, height,
      plan: compileRelationRenderPlan(record.derivationStages), completedCanvas: steps.find(step => step.replayFrameIndex === 6 && step.replayKind === 'macro').replayCanvasData });
    const viewport = availableTreeViewport(width, height, { headerBottom: 100, panelTop: height - 230 });
    const camera = fit(bounds, viewport, width);
    const maximumLayoutShiftAtCurrentFit = Math.max(...current.map((point, index) => Math.hypot(point.x - original[index].x, point.y - original[index].y) * camera.k));
    assert(maximumLayoutShiftAtCurrentFit < 6, 'the geometry adjustment, excluding the stage camera change, stays below six fitted pixels');
    const previousBounds = buildStageCameraBounds({ steps, stageIndex: 5, width, height,
      plan: compileRelationRenderPlan(record.derivationStages), completedCanvas: before.replayCanvasData });
    const previousCamera = fit(previousBounds, viewport, width);
    const maximumFullScreenShift = Math.max(...current.map(point => {
      const old = original.find(candidate => candidate.id === point.id);
      const from = previousCamera.apply([old.x, old.y]), to = camera.apply([point.x, point.y]);
      return Math.hypot(to[0] - from[0], to[1] - from[1]);
    }));
    assert(Number.isFinite(maximumFullScreenShift), 'the actual boundary displacement includes both camera transforms');
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
        stageTreeLayoutSize(steps, step.replayFrameIndex, 1596, 1016), steps);
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
  const dependencies = { d3, STAGE_CAMERA_PADDING, stageCameraBounds: bounds, derivationFrameFitNodes: [{}], overlayFitBounds: null,
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
        const viewport = availableTreeViewport(width, height, { headerBottom: 100, panelTop: height - 230 });
        const camera = fit(bounds, viewport, width);
        for (const x of [bounds.minX, bounds.maxX]) for (const y of [bounds.minY, bounds.maxY]) {
          const [screenX, screenY] = camera.apply([x, y]);
          assert(screenX >= viewport.left && screenX <= viewport.right, 'production fit must stay inside horizontal viewport');
          assert(screenY >= viewport.top && screenY <= viewport.bottom, 'production fit must avoid header and Replay controls');
        }
        for (const step of stageSteps) {
          const tree = productionTreeLayout(step.replayCanvasData, width, height,
            stageTreeLayoutSize(steps, stageIndex, width, height), steps);
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
    const tree = productionTreeLayout(step.replayCanvasData, input.width, input.height, size, steps);
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
        const tree = productionTreeLayout(step.replayCanvasData, width, height,
          stageTreeLayoutSize(steps, 0, width, height), steps);
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
  const after = steps.find(step => step.replayRelationIdentity?.stageIndex === 5
    && step.replayRelationIdentity.relationIndex === 1);
  assert(after, 'the fixture must include its authored do-support moment');
  const before = steps[steps.indexOf(after) - 1];
  assert.equal(before.replayFrameIndex, after.replayFrameIndex);
  assert.equal(d3.hierarchy(after.replayCanvasData).descendants().length,
    d3.hierarchy(before.replayCanvasData).descendants().length + 1);
  const original = JSON.stringify(steps);
  for (const [width, height] of [[1596, 1016], [386, 698]]) {
    const size = stageTreeLayoutSize(steps, before.replayFrameIndex, width, height);
    const oldTree = productionTreeLayout(before.replayCanvasData, width, height, size, steps);
    const newTree = productionTreeLayout(after.replayCanvasData, width, height, size, steps);
    const byId = new Map(newTree.descendants().map(node => [node.data.id, node]));
    for (const node of oldTree.descendants()) {
      const next = byId.get(node.data.id);
      assert(next, `${node.data.id} must survive do-support`);
      assert(Math.abs(next.x - node.x) < 1e-8, `${node.data.id} must not shift horizontally`);
      assert(Math.abs(next.y - node.y) < 1e-8, `${node.data.id} must not shift vertically`);
    }
    assert.equal(oldTree.descendants().some(node => node.data.id === 'raisedT::__leaf'), false);
    assert(byId.has('raisedT::__leaf'), 'did must still appear only at do-support');
    assert.deepEqual(stageTreeLayoutSize([...steps].reverse(), before.replayFrameIndex, width, height), size);
    assert.deepEqual(stageTreeLayoutSize(steps.filter(step => step.replayFrameIndex === before.replayFrameIndex), before.replayFrameIndex, width, height), size,
      'later stages must not enlarge the current stage');
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

for (const [width, height] of [[390, 844], [1600, 1100]]) {
  for (const direction of ['ltr', 'rtl']) {
    test(`${width}px ${direction}: stage camera contains long terminal labels without changing syntax`, () => {
      const word = 'unusually_long_terminal_'.repeat(5);
      const analysis = { derivationStages: [{ statement: 'Select the nominal.', stageRecord: 'One nominal phrase.', relations: [],
        workspaceForest: [{ id: 'phrase', label: 'NP', children: [{ id: 'noun', label: 'N', word }] }] }] };
      const steps = buildReplayPlayback({ sentence: word, analyses: [analysis] }).steps;
      const before = JSON.stringify(steps), completedCanvas = steps.at(-1).replayCanvasData;
      const size = stageTreeLayoutSize(steps, 0, width, height);
      const reservations = buildStageCoordinateReservations(steps, 0, size, () => size, direction);
      const bounds = buildStageCameraBounds({ steps, stageIndex: 0, completedCanvas, plan: null, width, height, direction,
        coordinates: new Map([[0, reservations]]) });
      const viewport = availableTreeViewport(width, height, { headerBottom: 70, panelTop: height - 260 });
      const fitted = fit(bounds, viewport, width);
      for (const step of steps) {
        const root = d3.hierarchy(step.replayCanvasData);applyVizIds(root);
        const tree = layoutSyntaxTree(root, size, direction, reservations.get(step.replayCanvasData), new Set(step.replayVisibleNodeIds));
        const visible = new Set(step.replayVisibleNodeIds);
        const nodes = tree.descendants().filter(n => visible.has(n.__vizId ?? n.data.id));
        for (const rect of treeInkObstacles(nodes).filter(rect => rect.connectorAttachment?.endsWith(':terminal'))) {
          const left = fitted.applyX(rect.x), right = fitted.applyX(rect.x + rect.width);
          assert(left >= viewport.left - 1e-7 && right <= viewport.right + 1e-7,
            `The complete terminal must fit: ${left}..${right}, viewport ${viewport.left}..${viewport.right}`);
        }
      }
      assert.equal(JSON.stringify(steps), before, 'Fitting must preserve Replay and syntax');
    });
  }
}

test('ordinary labels retain the original stage framing exactly', () => {
  const analysis = { derivationStages: [{ statement: 'Select the nominal.', stageRecord: 'One nominal phrase.', relations: [],
    workspaceForest: [{ id: 'phrase', label: 'NP', children: [{ id: 'noun', label: 'N', word: 'book' }] }] }] };
  const steps = buildReplayPlayback({ sentence: 'book', analyses: [analysis] }).steps;
  for (const [width, height] of [[390, 844], [1600, 1100]]) {
    const size = stageTreeLayoutSize(steps, 0, width, height);
    const reservations = buildStageCoordinateReservations(steps, 0, size, () => size);
    const points = steps.flatMap(step => {
      const root = d3.hierarchy(step.replayCanvasData);applyVizIds(root);
      const visible = new Set(step.replayVisibleNodeIds);
      return layoutSyntaxTree(root, size, 'ltr', reservations.get(step.replayCanvasData), visible).descendants()
        .filter(n => visible.has(n.__vizId ?? n.data.id));
    });
    const original = { minX: Math.min(...points.map(n => n.x)), maxX: Math.max(...points.map(n => n.x)),
      minY: Math.min(...points.map(n => n.y)), maxY: Math.max(...points.map(n => n.y + (n.children?.length ? 0 : 130))) };
    const current = buildStageCameraBounds({ steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
      plan: null, width, height, coordinates: new Map([[0, reservations]]) });
    assert.deepEqual(current, original);
  }
});

test('stage camera contains styled-label ink beyond the ordinary font envelope', () => {
  const analysis = { derivationStages: [{ statement: 'Select the nominal.', stageRecord: 'One nominal phrase.', relations: [],
    workspaceForest: [{ id: 'phrase', label: 'NP', children: [{ id: 'noun', label: 'N', word: 'book' }] }] }] };
  const steps = buildReplayPlayback({ sentence: 'book', analyses: [analysis] }).steps;
  const width = 390, height = 844, size = stageTreeLayoutSize(steps, 0, width, height);
  const reservations = buildStageCoordinateReservations(steps, 0, size, () => size);
  const run = { kind: 'terminal', text: 'book', indices: [{ text: '123', mode: 'theta' }] };
  const treeLabelRuns = new Map(steps.map(step => [step.replayCanvasData, new Map([['noun::__leaf', [run]]])]));
  const measureTreeLabel = () => ({ x: -310, y: 70, width: 1190, height: 460 });
  const bounds = buildStageCameraBounds({ steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData,
    plan: null, width, height, treeLabelRuns, measureTreeLabel, coordinates: new Map([[0, reservations]]) });
  const viewport = availableTreeViewport(width, height, { headerBottom: 70, panelTop: 584 });
  const fitted = fit(bounds, viewport, width);
  const step = steps.at(-1), root = d3.hierarchy(step.replayCanvasData);applyVizIds(root);
  const tree = layoutSyntaxTree(root, size, 'ltr', reservations.get(step.replayCanvasData), new Set(step.replayVisibleNodeIds));
  const terminal = tree.descendants().find(n => (n.__vizId ?? n.data.id) === 'noun::__leaf');assert(terminal);
  const ink = measureTreeLabel(run);
  for (const [x, y] of [[ink.x, ink.y], [ink.x + ink.width, ink.y + ink.height]]) {
    const [sx, sy] = fitted.apply([terminal.x + x, terminal.y + y]);
    assert(sx >= viewport.left - 1e-7 && sx <= viewport.right + 1e-7);
    assert(sy >= viewport.top - 1e-7 && sy <= viewport.bottom + 1e-7);
  }
});
