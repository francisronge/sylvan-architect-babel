import assert from 'node:assert/strict';
import test from 'node:test';
import { dependentCaseStatePlaques, featureSharingPlaqueRect } from '../replay/relations/markGeometry.ts';
import { nativePlaqueFootprints } from '../replay/relations/nativePlaqueSpace.ts';
import { PLAQUE_FIT_MARGIN } from '../replay/rendererMetrics.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { buildStageCameraBounds, measureStagePlaqueSpace } from '../replay/stageCamera.ts';

const ref = { stageIndex: 0, relationIndex: 0, relation: 'Fixture', anchors: {} };
const tree = { id: 'root', label: 'XP', children: ['probe', 'goal'].map(id => ({ id, label: 'NP',
  children: [{ id: `${id}Word`, label: 'N', word: id }] })) };
const stage = { statement: 'Test', stageRecord: 'Test', workspaceForest: [tree], relations: [] };
const steps = buildReplayPlayback({ sentence: 'probe goal', analyses: [{ tree, derivationStages: [stage] }] }).steps;
// The painted words sit far below the nominal word box the camera used to assume.
const runs = new Map([
  ...[['root', 'XP'], ['probe', 'NP'], ['goal', 'NP'], ['probeWord', 'N'], ['goalWord', 'N']].map(([id, label]) =>
    [id, [{ kind: 'category', text: label, lines: [label], indices: [] }]]),
  ...['probe', 'goal'].map(word => [`${word}Word::__leaf`, [{ kind: 'terminal', text: word, indices: [] }]])]);
const treeLabelRuns = new Map(steps.flatMap(step => step.replayCanvasData ? [[step.replayCanvasData, runs]] : []));
const measureTreeLabel = run => run.kind === 'terminal'
  ? { x: -190, y: 240, width: 380, height: 150 } : { x: -40, y: -60, width: 80, height: 62 };
const items = [
  { kind: 'undirected-link', linkStyle: 'feature-sharing', pairs: [{ fromNodeId: 'probe', toNodeId: 'goal' }], relationRef: ref },
  { kind: 'directed-path', pathStyle: 'dependent-case', fromNodeId: 'probe', toNodeId: 'goal',
    label: 'unvalued', secondaryLabel: 'accusative', dependentCaseStep: '2', relationRef: ref }
];

for (const item of items) test(`${item.linkStyle ?? item.pathStyle}: the stage camera fits the measured native plaque footprint`, () => {
  const input = { steps, stageIndex: 0, completedCanvas: steps.at(-1).replayCanvasData, plan: { frames: [{ items: [item] }] },
    width: 800, height: 700, includeOverlays: false, treeLabelRuns, measureTreeLabel };
  const bare = buildStageCameraBounds({ ...input, includePlaques: false });
  const fitted = buildStageCameraBounds({ ...input, includePlaques: true });
  // Allocation reserves each plaque from its anchors' measured labels.
  const nodes = measureStagePlaqueSpace(input).nodes, at = id => nodes.find(node => node.data.id === id);
  const measured = (id, kind) => {
    const node = at(id), box = measureTreeLabel({ kind });
    return { x: node.x + box.x, y: node.y + box.y, width: box.width, height: box.height };
  };
  const painted = item.kind === 'undirected-link'
    ? [featureSharingPlaqueRect([measured('probeWord::__leaf', 'terminal'), measured('goalWord::__leaf', 'terminal')])]
    : Object.values(dependentCaseStatePlaques(measured('probeWord::__leaf', 'terminal'), measured('goalWord::__leaf', 'terminal'),
      item.label, item.secondaryLabel, '2', measured('probe', 'category').y <= measured('goal', 'category').y));
  const footprints = nativePlaqueFootprints([item], nodes, { labels: runs, measureTreeLabel });
  assert.equal(footprints.length, painted.length);
  for (const [index, box] of painted.entries()) {
    assert.deepEqual(footprints[index], box, 'the reserved footprint is the painted plaque');
    assert(box.y + box.height > bare.maxY, 'the plaque reaches below the syntax');
  }
  assert.equal(fitted.maxY, Math.max(...painted.map(box => box.y + box.height)) + PLAQUE_FIT_MARGIN,
    'the camera reserves the measured plaque, not one below an estimated word');
});
