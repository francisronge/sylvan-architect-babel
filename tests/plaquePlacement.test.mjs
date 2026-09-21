import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { caseAssignmentSource, collectionPlaqueClears, plaqueCollectionConnectorObstacles, plaqueCaseConnectorObstacles, placeStagePlaques, plaqueIdentity, plaqueTreeObstacles, plaqueConnectorObstacles, plaquesOverlap, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { caseAssignmentPlaqueCurve } from '../replay/relations/overlayGeometry.ts';
import { sampleCubic } from '../replay/relations/markGeometry.ts';
import { stageTreeLayoutSize, buildStageLayoutGroups, buildStagePlaqueLayout, buildReplayPlaqueLayouts, buildStageCameraBounds, measureStagePlaqueSpace } from '../replay/stageCamera.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { applyVizIds, buildRenderableDerivationCanvasData } from '../replay/replayCompiler.ts';

const plaque = (ids, long = false) => ({ kind: 'node-plaque', plaqueStyle: 'feature',
  anchorNodeIds: ids, title: 'Authored relation', rows: [{ label: 'claim', value: long ? 'A complete authored explanation. '.repeat(15) : 'value' }],
  relationRef: { stageIndex: 0, relationIndex: 0 } });
const tree = () => d3.tree().nodeSize([600, 300])(d3.hierarchy({ id: 'root', label: 'XP', children: [
  { id: 'left', label: 'X', word: 'first' }, { id: 'right', label: 'Y', word: 'second' }
]}));

test('short category labels reserve their measured text instead of a fixed wide box', () => {
  const nodes = tree().descendants();
  for (const textWidth of [24, 110]) {
    const box = plaqueTreeObstacles(nodes, () => textWidth).find(box => box.connectorAttachment === 'left:category');
    assert.equal(box.width, textWidth + 16);
    assert.equal(box.x + box.width / 2, nodes.find(node => node.data.id === 'left').x);
    assert(box.y <= box.connectorInk.y && box.y + box.height >= box.connectorInk.y + box.connectorInk.height);
  }
});

for (const width of [1596, 390]) test(`${width}px: successive head movement leaves both Case plaques close to their sources`, () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/visual-relations/successive-head-movement.json', import.meta.url)));
  const replay = prepareReplay({ ...record, includePlayback: true });
  const input = { steps: replay.playbackSteps, stageIndex: 0, plan: replay.relationRenderPlan, width, height: 1016,
    layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames),
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest) };
  const layouts = buildReplayPlaqueLayouts(input);
  const remembered = new Map();
  for (let stageIndex = 0; stageIndex < layouts.length; stageIndex++) {
    const items = input.plan.frames[stageIndex].items;
    const space = measureStagePlaqueSpace({ ...input, stageIndex });
    for (const id of ['im', 'vm']) {
      const index = items.findIndex(item => item.pathStyle === 'case-assignment' && item.fromNodeId === id);
      const box = layouts[stageIndex].get(index), prior = remembered.get(id);
      assert(box);
      if (prior) {
        assert(Math.abs(box.x - box.attachmentX - prior.x + prior.attachmentX) < 1e-8);
        assert(Math.abs(box.y - box.attachmentY - prior.y + prior.attachmentY) < 1e-8);
      }
      remembered.set(id, box);
      for (const scene of space.scenes) {
        const positions = new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
        const projected = projectPlaqueLayout(new Map([[index, box]]), id => positions.get(id)).get(index);
        if (!projected) continue;
        assert(scene.obstacles.every(obstacle => !plaquesOverlap(projected, obstacle)), 'the pocket clears every future branch and movement');
      }
    }
    if (stageIndex !== layouts.length - 1) continue;
    const nominative = remembered.get('im'), accusative = remembered.get('vm');
    assert(nominative.x > nominative.attachmentX && nominative.y < nominative.attachmentY + 250,
      'nominative sits beside I instead of a long distance below it');
    const source = caseAssignmentSource(space.nodes.find(node => node.data.id === 'vm'));
    assert(accusative.y > source.y + 140 && accusative.y < source.y + 500,
      'accusative uses the nearby pocket beneath the pronounced verb');
    assert(accusative.x + accusative.width < nominative.x, 'the Case arrows approach separate nearby pockets');
  }
});

test('a small plaque uses a clear nearby pocket with room for its entire rectangle', () => {
  const nodes = tree().descendants();
  const result = placeStagePlaques([plaque(['left'])], nodes);
  const box = result.get(0);
  assert.equal(box.location, 'local');
  assert(plaqueTreeObstacles(nodes).every(obstacle => !plaquesOverlap(box, obstacle)));
});

test('an ordinary multiline feature plaque searches nearby pockets before using the tree bottom', () => {
  const nodes = tree().descendants();
  const item = { ...plaque(['left']), rows: [
    { label: 'Case', value: 'nominative' }, { label: 'phiFeatures', value: 'third-person singular' }
  ] };
  const box = placeStagePlaques([item], nodes).get(0);
  assert.ok(box.height > 170);
  assert.equal(box.location, 'local');
  assert.equal(box.attachmentNodeId, 'left');
  assert(plaqueTreeObstacles(nodes).every(obstacle => !plaquesOverlap(box, obstacle)));
});

test('large plaques are centered beneath their enclosing subtree and stack without lost content', () => {
  const nodes = tree().descendants();
  const items = [plaque(['left', 'right'], true), plaque(['left', 'right'], true)];
  const original = JSON.stringify(items);
  const result = placeStagePlaques(items, nodes);
  assert.equal(result.size, 2);
  for (const box of result.values()) {
    assert.equal(box.location, 'below');
    assert.equal(box.domainId, 'root');
    const obstacles = plaqueTreeObstacles(nodes);
    const domainCenter = (Math.min(...obstacles.map(rect => rect.x))
      + Math.max(...obstacles.map(rect => rect.x + rect.width))) / 2;
    assert.equal(box.x + box.width / 2, domainCenter);
    assert(box.y > 400);
  }
  assert(!plaquesOverlap(result.get(0), result.get(1)));
  assert.equal(JSON.stringify(items), original);
});

test('space reserved for a future word prevents an earlier plaque occupying its position', () => {
  const nodes = tree().descendants();
  const items = [plaque(['left'])];
  const initial = placeStagePlaques(items, nodes).get(0);
  const reserved = { ...initial };
  const result = placeStagePlaques(items, nodes, [...plaqueTreeObstacles(nodes), reserved]).get(0);
  assert(!plaquesOverlap(result, reserved));
});

test('small plaques use measured gaps before falling below the whole subtree', () => {
  const nodes = tree().descendants();
  const item = { ...plaque(['left', 'right']), plaqueStyle: 'theta-grid' };
  const anchor = nodes.find(node => node.data.id === 'left');
  // Leave a narrow vertical pocket between two wide reservations. None of the
  // fixed candidate heights fit, but the complete measured box does.
  const floor = anchor.y + 140;
  const obstacles = [
    { x: anchor.x - 1000, y: floor - 1000, width: 2000, height: 925 },
    { x: anchor.x - 1000, y: floor + 115, width: 2000, height: 1000 }
  ];
  const box = placeStagePlaques([item], nodes, obstacles).get(0);
  assert.equal(box.location, 'local');
  assert(obstacles.every(obstacle => !plaquesOverlap(box, obstacle)));
  assert(box.y >= floor - 51 && box.y + box.height <= floor + 91);
});

test('plaques yield to neutral connector stems without displacing clear placements', () => {
  const nodes = tree().descendants();
  const item = plaque(['left']);
  const initial = placeStagePlaques([item], nodes).get(0);
  const witness = nodes.find(node => node.data.id === 'right');
  witness.x = initial.x + initial.width / 2;
  witness.y = initial.y - 10;
  const fallback = { kind: 'fallback', drawing: { marks: [], link: { endpoints: ['right', 'left'] } } };
  const stems = plaqueConnectorObstacles([fallback], nodes);
  assert(stems.some(stem => plaquesOverlap(initial, stem)), 'the original pocket obstructs a straight stem');
  const obstacles = [...plaqueTreeObstacles(nodes), ...stems];
  const previous = new Map([[plaqueIdentity(item), initial]]);
  const result = placeStagePlaques([item], nodes, obstacles, previous).get(0);
  assert(stems.every(stem => !plaquesOverlap(result, stem)), 'move the plaque out of the connector corridor');
  assert.equal(result.location, 'local');
  assert.deepEqual(plaqueConnectorObstacles([{ ...fallback, drawing: { marks: [] } }], nodes), [],
    'one participant or a fan does not reserve a lower connector');
});

test('new stage syntax can displace a carried plaque without changing its claim or nodes', () => {
  const nodes = tree().descendants(), item = plaque(['left']);
  const original = placeStagePlaques([item], nodes).get(0);
  const obstacle = { x: original.x, y: original.y, width: original.width, height: original.height };
  const previous = new Map([[plaqueIdentity(item), original]]);
  const next = placeStagePlaques([item], nodes, [...plaqueTreeObstacles(nodes), obstacle], previous).get(0);
  assert(!plaquesOverlap(next, obstacle));
  assert.equal(previous.get(plaqueIdentity(item)), original);
  assert.deepEqual(placeStagePlaques([item], nodes, plaqueTreeObstacles(nodes), previous).get(0), original,
    'an unobstructed carried placement remains exact');
});

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/saved-qualification.json', import.meta.url)));

test('carried plaques follow their claim, not an item index or a newly free pocket', () => {
  const nodes = tree().descendants();
  const first = plaque(['left']);
  const second = { ...plaque(['right']), relationRef: { stageIndex: 1, relationIndex: 0 } };
  const original = placeStagePlaques([first], nodes);
  const remembered = new Map([[plaqueIdentity(first), original.get(0)]]);
  const next = placeStagePlaques([second, first], nodes, [], remembered);
  assert.deepEqual(next.get(1), original.get(0));
  assert(!plaquesOverlap(next.get(0), next.get(1)));
});

test('a predicate spelling change reserves the later grid width before the plaque appears', () => {
  const first = tree().data, later = structuredClone(first);
  later.children[0].word = 'A much longer authored predicate';
  const item = { ...plaque(['left']), plaqueStyle: 'theta-grid', thetaRoles: [{ nodeId: 'right', label: 'Theme', index: 'i' }] };
  const steps = [first, later].map((replayCanvasData, replayFrameIndex) => ({ replayCanvasData, replayFrameIndex, replayKind: 'macro' }));
  const plan = { frames: [0, 1].map(() => ({ items: [item] })) };
  const layouts = buildReplayPlaqueLayouts({ steps, stageIndex: 0, completedCanvas: later, plan, width: 1200, height: 900 });
  const [before, after] = layouts.map(layout => layout.get(0));
  assert(before.width > placeStagePlaques([item], tree().descendants()).get(0).width);
  assert.equal(before.width, after.width);
  assert.equal(before.x - before.attachmentX, after.x - after.attachmentX);
  assert.equal(before.y - before.attachmentY, after.y - after.attachmentY);
});

for (const record of records) {
  test(`${record.name}: carried plaques reserve future branches before their first appearance`, () => {
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    const plan = compileRelationRenderPlan(record.derivationStages);
    const layouts = buildReplayPlaqueLayouts({ steps, stageIndex: 0, plan, width: 1596, height: 1016,
      completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages.at(-1).workspaceForest) });
    let previous = new Map();
    let carried = 0;
    for (const [stageIndex, stage] of record.derivationStages.entries()) {
      const input = { steps, stageIndex, plan, width: 1596, height: 1016,
        completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
      const layout = layouts[stageIndex];
      const { scenes } = measureStagePlaqueSpace(input);
      for (const scene of scenes) {
        const positions = new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
        const boxes = [...projectPlaqueLayout(layout, id => positions.get(id)).values()];
        boxes.forEach((box, i) => {
          assert(scene.obstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)));
          assert(boxes.slice(i + 1).every(other => !plaquesOverlap(box, other, 0)));
        });
      }
      const current = new Map([...layout].map(([index, box]) => [plaqueIdentity(plan.frames[stageIndex].items[index]), box]));
      for (const [key, box] of current) {
        const prior = previous.get(key);
        if (!prior) continue;
        carried++;
        assert.equal(box.attachmentNodeId, prior.attachmentNodeId);
        assert.equal(box.location, prior.location);
        assert(Math.abs((box.x - box.attachmentX) - (prior.x - prior.attachmentX)) < 1e-8);
        assert(Math.abs((box.y - box.attachmentY) - (prior.y - prior.attachmentY)) < 1e-8);
      }
      previous = current;
    }
    assert(carried > 0);
  });
}
function replayTree(step, steps, width, height) {
  const root = d3.hierarchy(step.replayCanvasData);
  applyVizIds(root);
  return d3.tree().size(stageTreeLayoutSize(steps, step.replayFrameIndex, width, height))
    .separation((a, b) => a.parent === b.parent ? 2.5 : 3.5)(root);
}

test('a probe plaque is reserved against actual Replay coordinates', () => {
  const record = records.find(record => record.name === 'astra-minimalism');
  const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
  const plan = compileRelationRenderPlan(record.derivationStages);
  const stageIndex = 2;
  const firstProbe = steps.find(step => step.replayRelationIdentity?.stageIndex === stageIndex);
  const root = replayTree(firstProbe, steps, 1596, 1016);
  const layout = buildStagePlaqueLayout({ steps, stageIndex, plan, width: 1596, height: 1016,
    completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[stageIndex].workspaceForest) });
  const box = [...layout.values()][0];
  const anchor = root.descendants().find(node => node.data.id === box.attachmentNodeId);
  assert.equal(box.attachmentX, anchor.x);
  assert.equal(box.attachmentY, anchor.y);
  const visible = new Set(firstProbe.replayVisibleNodeIds);
  const obstacles = plaqueTreeObstacles(root.descendants().filter(node => visible.has(node.__vizId ?? node.data.id)));
  assert(obstacles.every(obstacle => !plaquesOverlap(box, obstacle)));
});

for (const record of records) {
  for (const [width, height] of [[1596, 1016], [390, 844]]) {
    test(`${record.name} ${width}px: complete stage allocation, no plaque collisions, stable traversal and fit`, () => {
      const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
      const plan = compileRelationRenderPlan(record.derivationStages);
      const original = JSON.stringify({ steps, plan });
      record.derivationStages.forEach((stage, stageIndex) => {
        const input = { steps, stageIndex, plan, width, height,
          completedCanvas: buildRenderableDerivationCanvasData(stage.workspaceForest) };
        const layout = buildStagePlaqueLayout(input);
        for (const scene of measureStagePlaqueSpace(input).scenes) {
          const byId = new Map(scene.nodes.map(node => [node.__vizId ?? node.data.id, node]));
          assert([...projectPlaqueLayout(layout, id => byId.get(id)).values()].every(box => scene.obstacles
            .every(obstacle => !plaquesOverlap(box, obstacle, 0))), 'projected plaques clear syntax and movement trajectories');
        }
        assert.deepEqual(layout, buildStagePlaqueLayout({ ...input, steps: [...steps].reverse() }));
        const bounds = buildStageCameraBounds({ ...input, plaqueLayout: layout });
        const boxes = [...layout.values()];
        boxes.forEach((box, index) => {
          assert(Object.values(box).filter(value => typeof value === 'number').every(Number.isFinite));
          assert(box.x >= bounds.minX && box.x + box.width <= bounds.maxX);
          assert(box.y >= bounds.minY && box.y + box.height <= bounds.maxY);
          boxes.slice(index + 1).forEach(other => assert(!plaquesOverlap(box, other), 'reserved plaques overlap'));
        });
        for (const step of steps.filter(step => step.replayFrameIndex === stageIndex)) {
          const root = replayTree(step, steps, width, height);
          const nodes = new Map(root.descendants().map(node => [node.__vizId ?? node.data.id, node]));
          const visibleIds = new Set(step.replayVisibleNodeIds);
          const treeObstacles = plaqueTreeObstacles(root.descendants().filter(node =>
            visibleIds.has(node.__vizId ?? node.data.id)));
          const projected = projectPlaqueLayout(layout, id => nodes.get(id) ?? null);
          for (const [index, box] of projected) {
            const reserved = layout.get(index);
            const anchor = nodes.get(box.attachmentNodeId);
            assert(Math.abs((box.x - anchor.x) - (reserved.x - reserved.attachmentX)) < 1e-8,
              'Replay must preserve the chosen horizontal offset, not choose another pocket');
            assert(Math.abs((box.y - anchor.y) - (reserved.y - reserved.attachmentY)) < 1e-8,
              'Replay must preserve the chosen vertical offset');
            assert(box.x >= bounds.minX && box.x + box.width <= bounds.maxX);
            assert(box.y >= bounds.minY && box.y + box.height <= bounds.maxY);
            assert(treeObstacles.every(obstacle => !plaquesOverlap(box, obstacle, 0)),
              `${record.name} stage ${stageIndex + 1} ${step.targetLabel}: plaque ${index} covers Replay tree geometry`);
          }
          const frameBoxes = [...projected.values()];
          frameBoxes.forEach((box, index) => frameBoxes.slice(index + 1)
            .forEach(other => assert(!plaquesOverlap(box, other, 0), 'projected plaques overlap')));
        }
      });
      assert.equal(JSON.stringify({ steps, plan }), original, 'placement cannot alter analysis, timing, or classification');
    });
  }
}

test('below-tree plaques cannot escape a connector stem by moving below its tree reservation', () => {
  const nodes = tree().descendants();
  const item = plaque(['root'], true);
  const fallback = { kind: 'fallback', drawing: { marks: [], link: { endpoints: ['root', 'right'] } } };
  const stems = plaqueConnectorObstacles([fallback], nodes);
  const original = placeStagePlaques([item], nodes).get(0);
  const result = placeStagePlaques([item], nodes, [...plaqueTreeObstacles(nodes), ...stems],
    new Map([[plaqueIdentity(item), original]])).get(0);
  assert.equal(result.location, 'below');
  assert.notEqual(result.x, original.x, 'the plaque must use a clear column, not sink beneath the old stem end');
  assert(stems.every(stem => !plaquesOverlap(result, stem)));
  assert(Object.values(result).filter(v => typeof v === 'number').every(Number.isFinite));
  const extended = stems.map(stem => ({ ...stem, height: result.y + result.height + 500 }));
  assert(extended.every(stem => !plaquesOverlap(result, stem)), 'longer lower lanes remain clear');
});

test('a complex Case assigner anchors to its category, never the empty space between words', () => {
  const complex = d3.hierarchy({ id: 'complex', label: 'V', children: [
    { id: 'root', label: 'V', word: 'read' }, { id: 'suffix', label: 'M', word: 'n' }
  ] });
  assert.equal(caseAssignmentSource(complex), complex);
  const single = d3.hierarchy({ id: 'head', label: 'V', children: [{ id: 'word', word: 'read' }] });
  assert.equal(caseAssignmentSource(single).data.id, 'word');
  const abstract = d3.hierarchy({ id: 'head', label: 'T', silent: true });
  assert.equal(caseAssignmentSource(abstract), abstract);
});

test('Case placement avoids an existing plaque in its curved approach and reserves that approach for later plaques', () => {
  const nodes = tree().descendants();
  const item = { kind: 'directed-path', pathStyle: 'case-assignment', fromNodeId: 'left', toNodeId: 'right',
    featureRow: { label: 'Case', value: 'accusative' }, relationRef: { stageIndex: 0, relationIndex: 0 } };
  const original = placeStagePlaques([item], nodes);
  const path = plaqueCaseConnectorObstacles([item], nodes, original);
  assert(path.length > 0);
  const middle = path[Math.floor(path.length / 2)];
  const blocker = { x: middle.x - 10, y: middle.y - 10, width: 30, height: 30, blocksConnectors: true };
  const clear = placeStagePlaques([item], nodes, [...plaqueTreeObstacles(nodes), blocker]);
  assert(plaqueCaseConnectorObstacles([item], nodes, clear).every(segment => !plaquesOverlap(segment, blocker, 0)));
  assert(!plaquesOverlap(clear.get(0), blocker));
  const second = { ...plaque(['left']), relationRef: { stageIndex: 0, relationIndex: 1 } };
  const together = placeStagePlaques([item, second], nodes);
  assert(plaqueCaseConnectorObstacles([item, second], nodes, together).every(segment => !plaquesOverlap(segment, together.get(1), 0)));
});

test('connector clearance reserves rendered words without an invisible duplicate category', () => {
  const root = d3.hierarchy({ id: 'head', label: 'V', children: [
    { id: 'word', label: 'read', word: 'read', replayOrigin: { kind: 'word', ownerId: 'head' } }
  ] });
  d3.tree().size([800, 500])(root);
  const obstacles = plaqueTreeObstacles(root.descendants());
  assert(obstacles.some(rect => rect.connectorAttachment === 'word:terminal'));
  assert(!obstacles.some(rect => rect.connectorAttachment === 'word:category'),
    'a display word has no category ink above its terminal');
  assert(obstacles.some(rect => rect.connectorAttachment === 'head:category'));
});


test('rows above Case do not lengthen its curved approach when the same pocket is clear', () => {
  const nodes = tree().descendants();
  const assignment = { relation: 'CaseAssignment', anchors: { assigner: 'left', bearer: 'right' }, values: { feature: 'Case', value: 'DAT' } };
  const compile = relations => compileRelationRenderPlan([{ statement: 'Assign and agree.', stageRecord: 'Exact participants.',
    workspaceForest: [nodes[0].data], relations }]).frames[0].items;
  const plain = compile([assignment]);
  const composed = compile([
    { relation: 'Finite features', anchors: { finiteHead: 'left' }, values: { number: 'singular', person: 'third' } },
    assignment, { relation: 'Agreement', anchors: { head: 'left', specifier: 'right' }, values: { agreement: 'third-person singular' } }
  ]);
  const plainIndex = plain.findIndex(item => item.pathStyle === 'case-assignment');
  const composedIndex = composed.findIndex(item => item.pathStyle === 'case-assignment');
  const before = placeStagePlaques(plain, nodes, []).get(plainIndex);
  const after = placeStagePlaques(composed, nodes, []).get(composedIndex);
  assert(after.caseRowY > before.caseRowY, 'the shared plaque has rows above Case');
  assert.equal(after.y + after.caseRowY, before.y + before.caseRowY, 'the Case arrow reaches the same height');
  const sourceX = nodes.find(node => node.data.id === 'left').x;
  const edgeDistance = box => Math.min(Math.abs(box.x - sourceX), Math.abs(box.x + box.width - sourceX));
  assert.equal(edgeDistance(after), edgeDistance(before), 'a mirrored pocket keeps the same short horizontal approach');
});

test('a fixed Orchard collection curve clears opaque ink by choosing its plaque pocket before it appears', () => {
  const nodes = tree().descendants();
  const items = compileRelationRenderPlan([{ statement: 'Agree.', stageRecord: 'Exact participants.', workspaceForest: [nodes[0].data],
    relations: [{ relation: 'Agreement', anchors: { head: 'left', specifier: 'right' }, values: { agreement: 'dual' } }] }]).frames[0].items;
  const index = items.findIndex(item => item.kind === 'node-plaque');
  const original = placeStagePlaques(items, nodes, []);
  const box = original.get(index);
  const source = plaqueTreeObstacles(nodes).find(rect => rect.connectorAttachment === 'right:category');
  const start = { x: box.x + box.width + 12, y: box.y + box.collectionRows[0].y };
  const blocker = { x: (start.x + source.x) / 2 - 12, y: (start.y + source.y + source.height / 2) / 2 - 12,
    width: 24, height: 24, blocksConnectors: true };
  assert.equal(collectionPlaqueClears(box, nodes, [blocker]), false);
  const obstacles = [...plaqueTreeObstacles(nodes), blocker];
  const identity = plaqueIdentity(items[index]);
  const moved = placeStagePlaques(items, nodes, obstacles, new Map([[identity, box]]), undefined, {
    sizes: new Map([[identity, { width: box.width, height: box.height }]]),
    spaceFor: () => ({ obstacles,
      acceptsConnector: candidate => collectionPlaqueClears(candidate, nodes, obstacles) })
  }).get(index);
  assert.notDeepEqual([moved.x, moved.y], [box.x, box.y], 'an invalid remembered pocket is rechecked before display');
  assert(collectionPlaqueClears(moved, nodes, [blocker]), 'the new pocket permits the fixed unobstructed curve');
  assert(!plaquesOverlap(moved, blocker));
});

for (const [width, height] of [[1596, 1016], [390, 844]]) {
  test(`${width}px: earlier grids leave room for the shared Case and agreement plaque`, () => {
    const record = JSON.parse(fs.readFileSync(new URL('../fixtures/visual-relations/shared-plaque.json', import.meta.url)));
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    const plan = compileRelationRenderPlan(record.derivationStages);
    const input = { steps, stageIndex: 2, plan, width, height,
      completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[2].workspaceForest) };
    const layouts = buildReplayPlaqueLayouts(input);
    assert.deepEqual(layouts, buildReplayPlaqueLayouts({ ...input, steps: [...steps].reverse() }),
      'frame traversal order cannot change the reserved pockets');
    const index = plan.frames[2].items.findIndex(item => item.pathStyle === 'case-assignment' && item.fromNodeId === 'iPast');
    const box = layouts[2].get(index);
    const nodes = measureStagePlaqueSpace(input).nodes;
    const source = caseAssignmentSource(nodes.find(node => node.data.id === 'iPast'));
    const curve = caseAssignmentPlaqueCurve({ x: source.x - 75, y: source.y + 65, width: 150, height: 60 },
      box, box.y + box.caseRowY);
    const points = sampleCubic(curve.source, curve.control1, curve.control2, curve.target, 32);
    const length = points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);
    assert(length < 425, `Case must use the nearest clear shared-plaque approach; got ${length}`);
    assert.equal(box.location, 'local');
    for (let stageIndex = 1; stageIndex < layouts.length; stageIndex++) {
      const items = plan.frames[stageIndex].items;
      for (const [itemIndex, placement] of layouts[stageIndex]) {
        const priorIndex = plan.frames[stageIndex - 1].items.findIndex(item => plaqueIdentity(item) === plaqueIdentity(items[itemIndex]));
        const prior = layouts[stageIndex - 1].get(priorIndex);
        if (!prior) continue;
        assert(Math.abs(placement.x - placement.attachmentX - prior.x + prior.attachmentX) < 1e-8);
        assert(Math.abs(placement.y - placement.attachmentY - prior.y + prior.attachmentY) < 1e-8);
      }
    }
    const segments = plaqueCollectionConnectorObstacles(nodes, new Map([[index, box]]));
    assert(segments.length > 0);
    for (const [otherIndex, other] of layouts[2]) {
      if (otherIndex !== index) assert(segments.every(segment => !plaquesOverlap(segment, other, 0)),
        'the collection curve must clear every earlier grid and plaque');
    }
  });
}

for (const [width, height] of [[1600, 1016], [390, 844]]) {
  test(`${width}px: collection clearance searches sideways before stretching the Case arrow below the tree`, () => {
    const record = JSON.parse(fs.readFileSync(new URL('../fixtures/visual-relations/case-collection-growth.json', import.meta.url)));
    const original = JSON.stringify(record);
    const steps = buildReplayPlayback({ sentence: record.sentence, analyses: [record] }).steps;
    const plan = compileRelationRenderPlan(record.derivationStages);
    const input = { steps, stageIndex: 1, plan, width, height,
      completedCanvas: buildRenderableDerivationCanvasData(record.derivationStages[1].workspaceForest) };
    const layouts = buildReplayPlaqueLayouts(input);
    const frame = plan.frames[1];
    const index = frame.items.findIndex(item => item.pathStyle === 'case-assignment' && item.fromNodeId === 'inflection');
    const box = layouts[1].get(index);
    assert(box.collectionRows.length, 'the Case plaque retains its agreement collection');
    assert(Math.hypot(box.x - box.attachmentX, box.y - box.attachmentY) < 1800,
      `a clear side pocket exists; the search must not place this plaque far below the tree: ${JSON.stringify(box)}`);
    const laterIndex = plan.frames[2].items.findIndex(item => plaqueIdentity(item) === plaqueIdentity(frame.items[index]));
    const later = layouts[2].get(laterIndex);
    assert(Math.abs(box.x - box.attachmentX - later.x + later.attachmentX) < 1e-8);
    assert(Math.abs(box.y - box.attachmentY - later.y + later.attachmentY) < 1e-8,
      'future inflection must not relocate an already visible plaque');
    for (const stageIndex of [1, 2]) {
      const space = measureStagePlaqueSpace({ ...input, stageIndex });
      const placement = layouts[stageIndex].get(stageIndex === 1 ? index : laterIndex);
      for (const scene of space.scenes) {
        const anchor = scene.nodes.find(node => node.data.id === placement.attachmentNodeId);
        if (!anchor) continue;
        const projected = projectPlaqueLayout(new Map([[0, placement]]), () => anchor).get(0);
        assert(scene.obstacles.every(obstacle => !plaquesOverlap(projected, obstacle)));
        if (stageIndex > 1 || scene.playedRelations?.has(3)) {
          assert(collectionPlaqueClears(projected, scene.nodes, scene.obstacles));
        }
      }
    }
    assert.equal(JSON.stringify(record), original);
  });
}
