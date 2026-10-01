import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan, resolveDisplayedTrajectoryAttachments } from '../replay/relations/renderPlanCompiler.ts';

const saved = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/holdout-transitions.json', import.meta.url)))
  .find(c => c.id === 'successive-trace');
const stages = () => structuredClone([saved.precedingStage, ...saved.derivationStages]);
const index = forest => {
  const nodes = new Map();
  const visit = n => { nodes.set(n.id, n); (n.children ?? []).forEach(visit); };
  forest.forEach(visit); return nodes;
};
const arrows = (plan, stage) => plan.frames[stage].items.filter(i => i.kind === 'trajectory');
const endpoints = items => items.map(i => [i.sourceNodeId, i.targetNodeId]);

for (const rename of [false, true]) test(`successive movement retains the intermediate landing${rename ? ' with renamed IDs' : ''}`, () => {
  const input = stages();
  const id = value => rename ? `renamed-${value}` : value;
  if (rename) for (const stage of input) {
    for (const node of index(stage.workspaceForest).values()) {
      node.id = id(node.id);
      if (node.lineageId) node.lineageId = id(node.lineageId);
    }
    for (const relation of stage.relations) for (const field of ['anchors', 'priorAnchors']) {
      for (const [key, value] of Object.entries(relation[field] ?? {}))
        relation[field][key] = Array.isArray(value) ? value.map(id) : id(value);
    }
  }
  const original = structuredClone(input), plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 1)), [[id('tObject'), id('wh')]]);
  const [earlier, later] = arrows(plan, 2);
  assert.deepEqual(endpoints([earlier, later]), [[id('tObject'), id('tEdge')], [id('tEdge'), id('wh')]]);
  const at = played => resolveDisplayedTrajectoryAttachments(earlier,
    nodeId => index(input[2].workspaceForest).get(nodeId), { stageIndex: 2, playedRelationIndices: played });
  assert.equal(at(new Set()).targetNodeId, id('wh'), 'before the second hop, the first arrow still reaches the phrase');
  assert.equal(at(new Set([0])).targetNodeId, id('tEdge'), 'the endpoint transfers at the second movement moment');
  assert.equal(at(null).targetNodeId, id('tEdge'), 'the completed stage preserves the intermediate landing');
  assert.equal(at(new Set()).targetNodeId, id('wh'), 'rewind restores the preceding endpoint');
  assert.equal(earlier.relationRef.anchors.movedPhrase, id('wh'), 'authored evidence remains unchanged');
  assert.deepEqual(input, original);
});

test('an earlier landing does not transfer without one unambiguous later movement', () => {
  for (const mutate of [
    s => { s[2].relations.shift(); },
    s => { s[2].relations[0].priorAnchors.sourcePhrase = 'unresolved'; },
    s => { s[2].relations.push(structuredClone(s[2].relations[0])); }
  ]) {
    const input = stages(); mutate(input);
    const earlier = arrows(compileRelationRenderPlan(input), 2).find(i => i.relationRef.stageIndex === 1);
    assert.equal(earlier.targetNodeId, 'wh');
    assert.equal(earlier.occurrenceTransfers, undefined);
  }
});

test('a third hop keeps both preceding landings and does not move identity marks onto a trace', () => {
  const input = stages(), last = structuredClone(input.at(-1));
  const phrase = last.workspaceForest[0].children.shift();
  last.workspaceForest[0].children.unshift({ id: 'tHigher', label: 'NP: A′-trace', lineageId: 'portraitChain', silent: true });
  last.workspaceForest = [{ id: 'outer', label: 'CP', children: [phrase, ...last.workspaceForest] }];
  last.relations = [{ relation: 'Further displacement', anchors: { source: 'tHigher', landing: 'wh' }, priorAnchors: { source: 'wh' } }];
  input.push(last);
  const plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 3)), [['tObject', 'tEdge'], ['tEdge', 'tHigher'], ['tHigher', 'wh']]);
  const coindices = plan.frames[3].items.filter(i => i.kind === 'coindex' && i.nodeIds.includes('wh'));
  assert(coindices.length > 0, 'identity marks keep referring to the moving phrase');
  const nodes = index(last.workspaceForest);
  assert.deepEqual(endpoints(arrows(plan, 3).slice(0, 2).map(i => resolveDisplayedTrajectoryAttachments(i,
    id => nodes.get(id), { stageIndex: 3, playedRelationIndices: new Set() }))), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
});

test('a later description of the first hop still shares its arrow after another movement', () => {
  const input = stages(), description = structuredClone(input[1]);
  description.relations = [{ relation: 'A-chain', anchors: { foot: 'tObject', head: 'wh' } }];
  input.splice(2, 0, description);
  const plan = compileRelationRenderPlan(input);
  assert.deepEqual(endpoints(arrows(plan, 2)), [['tObject', 'wh']]);
  assert.deepEqual(endpoints(arrows(plan, 3)), [['tObject', 'tEdge'], ['tEdge', 'wh']]);
  assert(arrows(plan, 3)[0].coalescedRefs.some(ref => ref.stageIndex === 2), 'both claims retain ownership of their shared arrow');
});
