import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

function shorteningScenario(relationName, persistentTrajectory = false) {
  const longWord = 'abcdefghijklmnopqrstuvwxabcdefghijklmnop';
  const noun = () => ({ id: 'object', label: 'N', children: [{ id: 'object-word', label: 'Bob', word: 'Bob' }] });
  const verb = (long = true) => ({ id: 'verb', label: 'V', children: [{
    id: 'verb-word', label: long ? longWord : 'did', word: long ? longWord : 'did'
  }] });
  const forest = children => ({ id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children });
  const phrase = long => ({ id: 'phrase', label: 'VP', children: [noun(), verb(long)] });
  const canvases = [noun(), forest([noun(), verb()]), forest([noun(), verb()]),
    phrase(true), phrase(false), forest([phrase(false), { id: 'tense', label: 'T' }])];
  const visible = [
    ['object', 'object-word'],
    ['object', 'object-word', 'verb-word'],
    ['object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word', 'tense']
  ];
  const operations = ['Project', 'LexicalSelect', 'Project', 'ExternalMerge', relationName, 'LexicalSelect'];
  const targets = ['object', 'verb-word', 'verb', 'phrase', 'verb-word', 'tense'];
  const steps = canvases.map((canvas, index) => ({
    replayFrameIndex: 0, replayStageStepIndex: index,
    replayKind: index === 4 ? 'relation' : 'micro', operation: operations[index],
    targetNodeId: targets[index], targetLabel: '', sourceLabels: [],
    replayRelationIdentity: index === 4 ? { stageIndex: 0, relationIndex: 1 } : undefined,
    replayRelationLinks: index === 4 && persistentTrajectory ? [{
      authoredRelationKey: '0:0', renderFamily: 'trajectory',
      priorSourceNodeId: 'verb', witnessNodeId: 'verb', targetNodeId: 'object'
    }] : [],
    replayCanvasData: canvas, replayVisibleNodeIds: visible[index]
  }));
  // The later selection changes the available layout. The candidate may reserve
  // that space early, but may not move its resulting discontinuity to PF.
  const coordinates = new Map(canvases.map((canvas, index) => [canvas, new Map(Object.entries({
    phrase: { x: 500, y: 0 }, object: { x: index === 5 ? 700 : 0, y: 200 },
    'object-word': { x: index === 5 ? 700 : 0, y: 400 },
    verb: { x: index === 5 ? 1200 : 1000, y: 200 },
    'verb-word': { x: index === 5 ? 1200 : 1000, y: 400 }, tense: { x: 1900, y: 0 }
  }))]));
  return { steps, coordinates, canvases };
}

for (const direction of ['ltr', 'rtl']) for (const relationName of ['PFRealization', 'Exponent correspondence']) {
  for (const persistentTrajectory of [false, true]) test(`${direction} ${relationName}${persistentTrajectory ? ' with an earlier trajectory' : ''}: a material-only relation cannot become the exit for a clearance shift`, () => {
    const { steps, coordinates, canvases } = shorteningScenario(relationName, persistentTrajectory);
    const original = JSON.stringify(steps), savedCoordinates = structuredClone(coordinates);
    const size = [2200, 1000];
    const result = reserveWorkspaceAttachments(steps, new Map([[0, size]]), direction, () => coordinates);
    const point = (frame, id) => {
      const step = steps[frame], root = d3.hierarchy(step.replayCanvasData);
      applyVizIds(root);
      const tree = layoutSyntaxTree(root, size, direction, result.get(step.replayCanvasData),
        new Set(step.replayVisibleNodeIds));
      return tree.descendants().find(node => getNodeId(node) === id);
    };
    assert.equal(coordinates.get(canvases[3]).get('verb-word').x,
      coordinates.get(canvases[4]).get('verb-word').x, 'the original PF step has no movement');
    const before = point(3, 'verb-word'), after = point(4, 'verb-word');
    assert.equal(after.x, before.x, 'changing the pronounced material must not relocate the same terminal');
    assert.equal(after.y, before.y);
    assert.equal(after.data.word, 'did', 'the authored realization still changes at its own moment');
    assert.equal(JSON.stringify(steps), original, 'placement does not alter the replay records');
    assert.deepEqual(coordinates, savedCoordinates, 'input reservations remain immutable');
  });
}
