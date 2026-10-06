import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { reserveWorkspaceAttachments } from '../replay/workspacePlacement.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';

function shorteningScenario(relationName, connected) {
  const longWord = 'abcdefghijklmnopqrstuvwxabcdefghijklmnop';
  const noun = () => ({ id: 'object', label: 'N', children: [{ id: 'object-word', label: 'Bob', word: 'Bob' }] });
  const verb = (long = true) => ({ id: 'verb', label: 'V', children: [{
    id: 'verb-word', label: long ? longWord : 'did', word: long ? longWord : 'did'
  }] });
  const forest = children => ({ id: 'workspace', label: '', replayOrigin: { kind: 'workspace' }, children });
  const phrase = long => ({ id: 'phrase', label: 'VP', children: [noun(), verb(long)] });
  const canvases = [noun(), forest([noun(), verb()]), forest([noun(), verb()]),
    phrase(true), phrase(false), forest([phrase(false), { id: 'tense', label: 'T' }])];
  for (const [index, canvas] of canvases.entries()) {
    const pending = [canvas]; let branch, nominal;
    while (pending.length) { const node = pending.pop(); if (node.id === 'verb') branch = node; if (node.id === 'object') nominal = node; pending.push(...(node.children ?? [])); }
    if (!branch) continue;
    const hidden = { id: 'invisible-parent', label: 'future', children: branch.children };
    branch.children = index < 4 ? [hidden] : [];
    if (index >= 4) nominal.children.push(hidden);
  }
  const visible = [
    ['object', 'object-word'],
    ['object', 'object-word', 'verb-word'],
    ['object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word'],
    ['phrase', 'object', 'object-word', 'verb', 'verb-word', 'tense']
  ];
  if (connected) for (const ids of visible) if (ids.includes('verb-word')) ids.push('invisible-parent');
  const operations = ['Project', 'LexicalSelect', 'Project', 'ExternalMerge', relationName, 'LexicalSelect'];
  const targets = ['object', 'verb-word', 'verb', 'phrase', 'verb-word', 'tense'];
  const steps = canvases.map((canvas, index) => ({
    replayFrameIndex: 0, replayStageStepIndex: index,
    replayKind: index === 4 ? 'relation' : 'micro', operation: operations[index],
    targetNodeId: targets[index], targetLabel: '', sourceLabels: [],
    replayRelationIdentity: index === 4 ? { stageIndex: 0, relationIndex: 1 } : undefined,
    replayCanvasData: canvas, replayVisibleNodeIds: visible[index]
  }));
  // The later selection changes the available layout. The candidate may reserve
  // that space early, but may not move its resulting discontinuity to PF.
  const coordinates = new Map(canvases.map((canvas, index) => [canvas, new Map(Object.entries({
    phrase: { x: 500, y: 0 }, object: { x: index === 5 ? 700 : 0, y: 200 },
    'object-word': { x: index === 5 ? 700 : 0, y: 400 },
    verb: { x: index === 5 ? 1200 : 1000, y: 200 },
    'verb-word': { x: (connected ? index >= 4 : index === 5) ? 1200 : 1000, y: 400 },
    'invisible-parent': {x: (connected ? index >= 4 : index === 5) ? 1200 : 1000, y:300}, tense: { x: 1900, y: 0 }
  }))]));
  return { steps, coordinates, canvases };
}

for (const direction of ['ltr', 'rtl']) for (const relationName of ['PFRealization', 'Exponent correspondence', 'Constituent movement']) {
  const connected = relationName === 'Constituent movement';
  test(`${direction} ${relationName}: ${connected ? 'a connected participant retains authored motion' : 'hidden scaffold reparenting cannot authorize motion'}`, () => {
    const {steps, coordinates} = shorteningScenario(relationName, connected);
    const savedSteps = JSON.stringify(steps), savedCoordinates = structuredClone(coordinates);
    const size = [2200, 1000];
    const result = reserveWorkspaceAttachments(steps, new Map([[0, size]]), direction, () => coordinates);
    const point = (frame, id, reservations = result) => {
      const step = steps[frame], root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
      return layoutSyntaxTree(root, size, direction, reservations.get(step.replayCanvasData), new Set(step.replayVisibleNodeIds))
        .descendants().find(node => getNodeId(node) === id);
    };
    const before = point(3, 'verb-word'), after = point(4, 'verb-word');
    const visibleParent = (node, frame) => node.parent && steps[frame].replayVisibleNodeIds.includes(getNodeId(node.parent)) ? getNodeId(node.parent) : null;
    assert.equal(visibleParent(before,3),visibleParent(after,4),'the immediate visible parent has not changed');
    if (connected) {
      assert(Math.abs(after.x-before.x)>1e-6,'the visible constituent can reparent at its relation');
      const finalRoot = point(5,'phrase'), nativeRoot = point(5,'phrase',coordinates);
      for (const id of steps[5].replayVisibleNodeIds.filter(id => id !== 'tense')) {
        const final = point(5,id), native = point(5,id,coordinates);
        assert(Math.hypot(final.x-finalRoot.x-(native.x-nativeRoot.x), final.y-finalRoot.y-(native.y-nativeRoot.y))<1e-6,
          `${id} preserves the completed relative geometry`);
      }
    }
    else {
      assert.equal(visibleParent(before,3),null,'the terminal remains a separate visible component');
      assert.equal(after.x,before.x,'changing invisible ancestors cannot move the separate terminal');
    }
    assert.equal(after.y,before.y);
    assert.equal(after.data.word,'did');
    assert.equal(JSON.stringify(steps),savedSteps);
    assert.deepEqual(coordinates,savedCoordinates);
  });
}
