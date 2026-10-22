import assert from 'node:assert/strict';
import test from 'node:test';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';

const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const node = (id, label, children) => ({ id, label, children });
const find = (forest, id) => {
  for (const item of forest) {
    if (item.id === id) return item;
    const nested = find(item.children ?? [], id);
    if (nested) return nested;
  }
};
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const projection = (category = 'T', label = 'T[Aux, finite]') => {
  const source = leaf('low', 'Aux[finite]', { word: 'has', tokenIndex: 0, lineageId: 'finite' });
  const complement = node('domain', 'Aux', [source,
    node('predicate', 'V', [leaf('verb', 'V', { word: 'read', tokenIndex: 1 })])]);
  const lower = structuredClone(complement);
  Object.assign(find([lower], 'low'), { silent: true });
  delete find([lower], 'low').tokenIndex;
  return {
    priorForest: [complement],
    currentForest: [node('projection', category, [
      leaf('high', label, { word: 'has', tokenIndex: 0, lineageId: 'finite' }), lower
    ])],
    relation: { relation: 'An authored dependency', anchors: { lowerCopy: 'low', higherCopy: 'high' },
      priorAnchors: { source: 'low' } }
  };
};

test('nested trailing annotations preserve category recognition without rewriting labels', () => {
  for (const [label, category, kind] of [
    ['C[T[Aux], finite]', 'C', 'head'],
    ['X [feature[value[nested]]] [other]', 'X', 'head'],
    ['NP[agreement[plural]]', 'NP', 'phrase'],
    ['V′[selection[DP]]', 'V', 'bar']
  ]) {
    const shape = readCategoryLabel(label);
    assert.equal(shape?.category, category, label);
    assert.equal(shape?.kind, kind, label);
  }
  for (const label of ['C[T[Aux], finite', 'C[T[Aux], finite]]', 'C[[T]',
    'C[T[Aux]] prose', 'C[T[Aux]] D', 'C, D[T[Aux]]'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

for (const [category, label] of [['T', 'T[Aux, finite]'], ['C[force]', 'C[T[Aux], finite]'],
  ['Z', 'Z[features[nested]]'], ['T', 'Aux+T[finite]'], ['T', 'T+Aux[finite]']]) test(`a lexical ${label} projects over its exact retained source domain`, () => {
  const input = projection(category, label), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.transition, true);
  assert.equal(movement?.sourceNodeId, 'low');
  assert.equal(movement?.targetNodeId, 'high');
  assert(!movement.context?.some(item => item.nodeId === 'domain'),
    'the clause complement does not become an adjoined head host');
  assert.deepEqual(input, original);
});

test('a moving lexical head may retain its ID while a new lower occurrence occupies its old slot', () => {
  const input = projection();
  find(input.currentForest, 'low').id = 'lower';
  find(input.currentForest, 'high').id = 'low';
  input.relation.anchors = { lowerCopy: 'lower', higherCopy: 'low' };
  const movement = recover(input).movement;
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.priorSourceNodeId, 'low');
  assert.equal(movement?.sourceNodeId, 'lower');
  assert.equal(movement?.targetNodeId, 'low');
});

test('a first projected head copy need not predeclare lineage on its persistent source', () => {
  const input = projection(); delete find(input.priorForest, 'low').lineageId;
  const original = structuredClone(input), movement = recover(input).movement;
  assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId,
    movement?.trajectoryKind], ['low', 'low', 'high', 'head']);
  assert.deepEqual(input, original);
});

test('bare head projection requires a unique identity and the retained complement', () => {
  for (const [name, mutate] of [
    ['mismatched parent category', input => { input.currentForest[0].label = 'Q'; }],
    ['mismatched landing category', input => { find(input.currentForest, 'high').label = 'Q[finite]'; }],
    ['missing current lineage', input => { delete find(input.currentForest, 'high').lineageId; }],
    ['conflicting prior lineage', input => { find(input.priorForest, 'low').lineageId = 'other'; }],
    ['conflicting lineage', input => { find(input.currentForest, 'low').lineageId = 'other'; }],
    ['missing lower occurrence', input => { find(input.currentForest, 'domain').children.shift(); }],
    ['unrelated complement', input => { find(input.currentForest, 'domain').id = 'unrelated'; }],
    ['changed complement', input => { find(input.currentForest, 'verb').word = 'write'; }],
    ['changed lower position', input => { find(input.currentForest, 'domain').children.reverse(); }],
    ['duplicated landing', input => { input.currentForest.push(structuredClone(find(input.currentForest, 'high'))); }],
    ['duplicated parent', input => { input.currentForest.push(leaf('projection', 'T')); }],
    ['duplicated prior complement', input => { input.priorForest.push(leaf('domain', 'Aux')); }],
    ['branching bare moving object', input => {
      for (const [forest, id] of [[input.priorForest, 'low'], [input.currentForest, 'low'], [input.currentForest, 'high']]) {
        const moving = find(forest, id); delete moving.word;
        moving.children = [leaf(`${id}-member`, 'D', { word: 'some' })];
      }
    }]
  ]) {
    const input = projection(); mutate(input);
    const movement = recover(input).movement;
    if (name === 'branching bare moving object') assert.notEqual(movement?.trajectoryKind, 'head', name);
    else assert.equal(movement, undefined, name);
  }
});

test('a branching bare phrase stays phrasal when it moves into a specifier', () => {
  const phrase = node('low', 'D', [leaf('name', 'N', { word: 'Mira', tokenIndex: 0 })]);
  phrase.lineageId = 'nominal';
  const priorForest = [node('domain', 'V', [phrase, leaf('predicate', 'V', { word: 'left', tokenIndex: 1 })])];
  const currentForest = [node('clause', 'T', [
    { ...structuredClone(phrase), id: 'high', children: [leaf('higher-name', 'N', { word: 'Mira', tokenIndex: 0 })] },
    node('inflection', 'T', [leaf('tense', 'T', { silent: true }),
      node('domain', 'V', [{ ...structuredClone(phrase), silent: true }, leaf('predicate', 'V', { word: 'left', tokenIndex: 1 })])])
  ])];
  const result = recoverMovementEvidence({ relation: 'An authored dependency',
    anchors: { lowerCopy: 'low', higherCopy: 'high' }, priorAnchors: { source: 'low' } }, currentForest, priorForest);
  assert.equal(result.movement?.trajectoryKind, 'phrasal');
});

test('Replay introduces the projected head, parent and trajectory atomically', () => {
  const input = projection('C[force]', 'C[T[Aux], finite]');
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, index) => ({
    statement: 'Completed state', stageRecord: '', workspaceForest,
    relations: index ? [{ relation: 'Earlier observation', anchors: { participant: 'verb' } }, input.relation] : []
  }));
  const original = structuredClone(stages);
  const plan = compileRelationRenderPlan(stages);
  const path = plan.frames[1].items.find(item => item.kind === 'trajectory' && item.relationRef.relationIndex === 1);
  assert.equal(path?.trajectoryKind, 'head');
  assert.equal(path?.sourceNodeId, 'low');
  assert.equal(path?.targetNodeId, 'high');
  const { steps } = buildReplayPlayback({ sentence: 'has read', analyses: [{ derivationStages: stages }] });
  const moment = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === 1
    && step.replayRelationIdentity.relationIndex === 1);
  assert(moment > 0);
  for (const step of steps.slice(0, moment)) {
    assert(!step.replayVisibleNodeIds.includes('high'));
    assert(!step.replayVisibleNodeIds.includes('projection'));
  }
  const before = steps[moment - 1], after = steps[moment];
  assert.notEqual(find([before.replayCanvasData], 'low')?.silent, true);
  assert.equal(find([after.replayCanvasData], 'low')?.silent, true);
  assert(after.replayVisibleNodeIds.includes('high'));
  assert(after.replayVisibleNodeIds.includes('projection'));
  assert(after.replayRelationLinks.some(link => link.renderFamily === 'trajectory'
    && link.sourceNodeId === 'low' && link.targetNodeId === 'high'));
  assert.equal(recoverMovementEvidence(input.relation, input.currentForest, input.currentForest).movement?.transition ?? false, false,
    'a restated state does not create another movement transition');
  assert.deepEqual(stages, original);
});
