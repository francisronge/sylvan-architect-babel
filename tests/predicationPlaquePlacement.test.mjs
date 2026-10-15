import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds } from '../replay/displayIdentity.ts';
import { createBindingRefinements } from '../components/renderer/bindingRefinements.ts';
import { predicationPaths } from '../replay/relations/predicationGeometry.ts';
import { predicationPlaqueObstacles } from '../replay/relations/predicationPlaqueSpace.ts';
import { plaquesOverlap, projectPlaqueLayout } from '../replay/relations/plaquePlacement.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildReplayPlaqueSchedule, buildStageLayoutGroups, measureStagePlaqueSpace, selectReplayPlaqueLayout } from '../replay/stageCamera.ts';
import { createSvgDom, select } from './helpers/svgDom.mjs';

const serialize = points => points.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

test('shared predication geometry preserves the production grouping, ordering and aligned lower elbow', () => {
  const dom = createSvgDom();
  try {
    const rects = {
      a: { x: 0, y: 0, width: 40, height: 20 }, far: { x: 800, y: 100, width: 60, height: 40 },
      near: { x: 300, y: 50, width: 100, height: 30 },
      b: { x: 1000, y: 200, width: 20, height: 20 }, aligned: { x: 1000, y: 250, width: 20, height: 20 }
    };
    const pairs = [{ fromNodeId: 'a', toNodeId: 'far' }, { fromNodeId: 'b', toNodeId: 'aligned' },
      { fromNodeId: 'a', toNodeId: 'near' }, { fromNodeId: 'a', toNodeId: 'missing' }];
    const expected = new Map([
      [0, [{ x: 29, y: 34 }, { x: 29, y: 220 }, { x: 830, y: 220 }, { x: 830, y: 154 }]],
      [1, [{ x: 1010, y: 234 }, { x: 1010, y: 322 }, { x: 1010, y: 322 }, { x: 1010, y: 284 }]],
      [2, [{ x: 11, y: 34 }, { x: 11, y: 192 }, { x: 350, y: 192 }, { x: 350, y: 94 }]]
    ]);
    for (const [dx, dy] of [[0, 0], [-530, 720]]) {
      const shifted = Object.fromEntries(Object.entries(rects).map(([id, box]) => [id, { ...box, x: box.x + dx, y: box.y + dy }]));
      const layer = select(new dom.Element('g'));
      const elements = pairs.map(pair => layer.append('path').attr('class', 'babel-predication-path')
        .attr('data-predicand', pair.fromNodeId).attr('data-predicate', pair.toNodeId).attr('d', 'unresolved').node());
      const { refinePredicationRelation } = createBindingRefinements({
        postFitNodeById: new Map(), measuredTerminalRect: () => null,
        measuredShellRect: id => shifted[id], unionRects: boxes => boxes[0] ?? null
      });
      refinePredicationRelation.call(layer.node());
      const geometry = predicationPaths(pairs, id => shifted[id] ?? null);
      assert.deepEqual(geometry.map(path => path.pairIndex), [2, 0, 1], 'authored group order and nearest predicate order stay distinct');
      for (const { pairIndex, points } of geometry) {
        assert.deepEqual(points, expected.get(pairIndex).map(p => ({ x: p.x + dx, y: p.y + dy })));
        assert.equal(elements[pairIndex].attrs.d, serialize(points));
      }
      assert.equal(elements[3].attrs.d, 'unresolved');
      assert.deepEqual(elements.map(element => [element.attrs['data-predicand'], element.attrs['data-predicate']]),
        pairs.map(pair => [pair.fromNodeId, pair.toNodeId]));
    }
  } finally { dom.restore(); }
});

test('plaque reservations contain existing elbows when measured variants swap target order, including mirrored scenes', () => {
  for (const direction of [1, -1]) for (const [dx, dy] of [[0, 0], [800, -400]]) {
    const root = d3.hierarchy({ id: 'root', label: 'XP', children: ['source', 'first', 'second'].map(id => ({ id, label: 'X' })) });
    applyVizIds(root);
    const nodes = root.descendants();
    nodes.forEach((node, i) => { node.x = [0, 0, 300, 340][i] * direction + dx; node.y = [0, 0, 50, 100][i] + dy; });
    const item = { kind: 'undirected-link', linkStyle: 'predication', pairs: [
      { fromNodeId: 'source', toNodeId: 'first' }, { fromNodeId: 'source', toNodeId: 'second' }
    ] };
    const labels = new Map(nodes.map(node => [node.data.id, [0, 1].map(variant => ({
      kind: 'category', text: `${node.data.id}:${variant}`, indices: []
    }))]));
    const measure = run => {
      const width = run.text === 'first:1' ? 240 : 40;
      return { x: direction > 0 ? -20 : 20 - width, y: -40, width, height: 30 };
    };
    const obstacles = predicationPlaqueObstacles([item], nodes, { labels, measureTreeLabel: measure });
    for (const variant of [0, 1]) {
      const rects = new Map(nodes.map(node => {
        const box = measure(labels.get(node.data.id)[variant]);
        return [node.data.id, { ...box, x: node.x + box.x, y: node.y + box.y }];
      }));
      const paths = predicationPaths(item.pairs, id => rects.get(id));
      assert.deepEqual(paths.map(path => path.pairIndex), variant ? [1, 0] : [0, 1]);
      for (const { points } of paths) for (let i = 1; i < points.length; i++) {
        assert(obstacles.some(box => [points[i - 1], points[i]].every(p =>
          p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height)),
        `existing segment must fit within its reservation: ${serialize(points)}`);
      }
    }
  }
});

test('coalesced syntax scenes reserve label variants from every distinct canvas identity', () => {
  const first = { id: 'root', label: 'XP', children: [{ id: 'source', label: 'X' }, { id: 'target', label: 'X' }] };
  const second = structuredClone(first);
  const steps = [first, second].map((replayCanvasData, index) => ({
    replayCanvasData, replayFrameIndex: 0, replayStageStepIndex: index, replayKind: 'macro'
  }));
  const labels = indexed => new Map(['root', 'source', 'target'].map(id => [id, [{
    kind: 'category', text: id, indices: indexed && id === 'source' ? [{ text: 'i', mode: 'identity' }] : []
  }]]));
  const treeLabelRuns = new Map([[first, labels(false)], [second, labels(true)]]);
  const measure = run => ({ x: -20, y: -40, width: run.indices.length ? 280 : 40, height: 30 });
  const item = { kind: 'undirected-link', linkStyle: 'predication', pairs: [{ fromNodeId: 'source', toNodeId: 'target' }] };
  const coordinates = new Map([['root', { x: 0, y: 0 }], ['source', { x: 0, y: 150 }], ['target', { x: 600, y: 150 }]]);
  const space = measureStagePlaqueSpace({ steps, stageIndex: 0, completedCanvas: second,
    width: 1600, height: 1100, plan: { frames: [{ items: [item] }] }, treeLabelRuns, measureTreeLabel: measure },
  { reservations: new Map([[first, coordinates], [second, coordinates]]) });
  assert.equal(space.scenes.length, 1);
  assert.deepEqual(space.scenes[0].stepIndices, [0, 1]);
  const nodes = space.scenes[0].nodes;
  const oldReservations = predicationPlaqueObstacles([item], nodes, { labels: labels(false), measureTreeLabel: measure });
  const rects = new Map(nodes.map(node => {
    const box = measure(treeLabelRuns.get(second).get(node.data.id)[0]);
    return [node.data.id, { ...box, x: node.x + box.x, y: node.y + box.y }];
  }));
  const [source, turn] = predicationPaths(item.pairs, id => rects.get(id))[0].points;
  const contains = box => [source, turn].every(p => p.x >= box.x && p.x <= box.x + box.width
    && p.y >= box.y && p.y <= box.y + box.height);
  assert(!oldReservations.some(contains), 'the first canvas alone misses the later indexed source stem');
  assert(space.scenes[0].obstacles.some(contains), 'the coalesced scene reserves that unchanged later stem');
});

const overlapRecord = () => {
  const name = { id: 'name', label: 'D', word: '小王', tokenIndex: 0 };
  const degree = { id: 'degree', label: 'Deg', word: '很' }, adjective = { id: 'adjective', label: 'A', word: '高' };
  const head = { id: 'predicationHead', label: 'Pred', silent: true }, tense = { id: 'tenseHead', label: 'T', silent: true };
  const predicate = { id: 'degreePredicate', label: 'Deg', children: [degree, adjective] };
  const clause = { id: 'subjectPredication', label: 'Pred', children: [name,
    { id: 'predicationComplement', label: 'Pred', children: [head, predicate] }] };
  const stage = (workspaceForest, relations = [], realizations) => ({ statement: 'Establish the current structure.',
    stageRecord: 'The current syntax and its interpretation are recorded separately.', workspaceForest, relations,
    ...(realizations ? { realizations } : {}) });
  const realizations = [{ nodeIds: ['degree', 'adjective'], tokenIndices: [1] }];
  return { sentence: '小王很高。', inputTokens: ['小王', '很高'], derivationStages: [
    stage([name, degree, adjective, head, tense]),
    stage([name, predicate, head, tense], [{ relation: 'collective input realization',
      anchors: { contributors: ['degree', 'adjective'] }, values: { inputToken: '很高' } }], realizations),
    stage([clause, tense], [{ relation: 'subject of predication',
      anchors: { subject: 'name', predicate: 'degreePredicate', predicationHead: 'predicationHead' },
      values: { interpretation: 'the property is predicated of the subject' } }], realizations),
    stage([clause, tense], [], realizations)
  ] };
};

for (const [width, height] of [[1600, 1100], [390, 844]]) test(`${width}px: an earlier PF plaque reserves the later predication elbow for its whole lifetime`, () => {
  const record = overlapRecord(), original = JSON.stringify(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const input = { steps: replay.playbackSteps, stageIndex: 2, completedCanvas: replay.playbackSteps.at(-1).replayCanvasData,
    plan: replay.relationRenderPlan, width, height, layoutGroups: buildStageLayoutGroups(replay.playbackSteps, replay.replayDerivationFrames) };
  const schedule = buildReplayPlaqueSchedule(input);
  const unreserved = buildReplayPlaqueSchedule({ ...input, plan: { ...input.plan,
    frames: input.plan.frames.map(frame => ({ ...frame, items: frame.items.filter(item => item.familyId !== 'predication.paths') })) } });
  const pocket = box => [box.x - box.attachmentX, box.y - box.attachmentY];
  const pockets = [];
  for (const stageIndex of [1, 2, 3]) {
    const items = input.plan.frames[stageIndex].items;
    const plaqueIndex = items.findIndex(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization');
    const space = measureStagePlaqueSpace({ ...input, stageIndex });
    const placement = schedule.stages[stageIndex].get(plaqueIndex);
    pockets.push(pocket(placement));
    for (const scene of space.scenes) {
      const current = selectReplayPlaqueLayout(schedule, stageIndex, scene.stepIndices[0]).get(plaqueIndex);
      const projected = projectPlaqueLayout(new Map([[plaqueIndex, current]]), id => scene.nodes.find(node => node.data.id === id) ?? null).get(plaqueIndex);
      if (!projected) continue;
      for (const obstacle of predicationPlaqueObstacles(items, scene.nodes)) assert(!plaquesOverlap(projected, obstacle, 0));
    }
    if (stageIndex === 2) {
      const old = [...unreserved.stages[stageIndex].values()][0];
      const obstacles = predicationPlaqueObstacles(items, space.scenes.at(-1).nodes);
      assert(obstacles.some(obstacle => plaquesOverlap(old, obstacle, 0)), 'the previously unreserved pocket overlaps the fixed connector');
      assert.notDeepEqual(pocket(placement), pocket(old), 'only the plaque changes pocket');
    }
  }
  for (const point of pockets.slice(1)) point.forEach((coordinate, axis) => assert(Math.abs(coordinate - pockets[0][axis]) < 1e-8));
  assert.equal(JSON.stringify(record), original);
});
