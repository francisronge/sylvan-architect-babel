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

// Bare Phrase Structure: the fused head v+V projects v over a VP that the same
// stage first joined with a locative adjunct, so that complement is new.
const assembledComplement = () => {
  const verb = leaf('verb', 'V', { word: 'saw', tokenIndex: 1, lineageId: 'verb' });
  const object = leaf('object', 'D', { word: 'Peter', tokenIndex: 2, lineageId: 'object' });
  const locative = node('locative', 'D', [leaf('det', 'D', { word: 'the', tokenIndex: 3 }), leaf('noun', 'N', { word: 'cinema', tokenIndex: 4 })]);
  const vp = node('vp', 'V', [verb, object]);
  const lowerVp = structuredClone(vp);
  Object.assign(find([lowerVp], 'verb'), { silent: true });
  delete find([lowerVp], 'verb').tokenIndex;
  return {
    priorForest: [vp, locative],
    currentForest: [node('vP', 'v', [leaf('subject', 'D', { word: 'Anna', tokenIndex: 0 }),
      node('vBar', 'v', [leaf('vHead', 'v+V', { word: 'saw', tokenIndex: 1, lineageId: 'verb' }),
        node('adjoined', 'V', [lowerVp, structuredClone(locative)])])])],
    relation: { relation: 'An authored dependency', anchors: { source: 'verb', landing: 'vHead' } }
  };
};

test('a fused head projecting over a complement assembled in its stage is a head landing', () => {
  const input = assembledComplement(), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.deepEqual([movement?.trajectoryKind, movement?.sourceNodeId, movement?.targetNodeId], ['head', 'verb', 'vHead']);
  assert.deepEqual(input, original);
});

test('a one-word phrase landing in the same assembled shape stays phrasal', () => {
  const input = assembledComplement();
  const vBar = find(input.currentForest, 'vBar');
  vBar.children[0] = leaf('vHead', 'v', { silent: true });
  find(input.currentForest, 'vP').children[0] = leaf('raised', 'D', { word: 'Peter', tokenIndex: 2, lineageId: 'object' });
  Object.assign(find(input.currentForest, 'object'), { silent: true });
  delete find(input.currentForest, 'object').tokenIndex;
  find(input.currentForest, 'verb').word = 'saw'; delete find(input.currentForest, 'verb').silent;
  find(input.currentForest, 'verb').tokenIndex = 1;
  input.relation = { relation: 'An authored dependency', anchors: { source: 'object', landing: 'raised' } };
  const movement = recover(input).movement;
  assert.deepEqual([movement?.trajectoryKind, movement?.sourceNodeId, movement?.targetNodeId], ['phrasal', 'object', 'raised']);
});

// A second adjunct joins over the first: [V [V VP D] A], two new levels.
const twoLevelAssembly = input => {
  input.priorForest.push(leaf('late', 'A', { word: 'late', tokenIndex: 5 }));
  const vBar = find(input.currentForest, 'vBar');
  vBar.children[1] = node('outer', 'V', [vBar.children[1], leaf('late', 'A', { word: 'late', tokenIndex: 5 })]);
  return input;
};

test('an assembled complement may hold several new levels', () => {
  const movement = recover(twoLevelAssembly(assembledComplement())).movement;
  assert.deepEqual([movement?.trajectoryKind, movement?.sourceNodeId, movement?.targetNodeId], ['head', 'verb', 'vHead']);
});

test('an assembled complement joins only unchanged earlier roots under new branching nodes', () => {
  for (const [name, mutate] of [
    ['a part taken from inside another earlier tree', input => {
      input.priorForest[1] = node('scene', 'P', [input.priorForest[1], leaf('at', 'P', { word: 'at' })]);
    }],
    ['a new node claiming an earlier object\'s lineage', input => {
      const other = node('other', 'V', [leaf('rest', 'V', { word: 'rested' })]);
      other.lineageId = 'predicate';
      input.priorForest.push(other); input.currentForest.push(structuredClone(other));
      find(input.currentForest, 'adjoined').lineageId = 'predicate';
    }],
    ['a new leaf in the complement', input => {
      find(input.currentForest, 'adjoined').children.push(leaf('extra', 'A', { word: 'late' }));
    }],
    ['a changed earlier root', input => { find(input.currentForest, 'noun').word = 'theatre'; }],
    ['a duplicated nested new node', input => { twoLevelAssembly(input).currentForest.push(leaf('adjoined', 'V')); }]
  ]) {
    const input = assembledComplement(); mutate(input);
    assert.notEqual(recover(input).movement?.trajectoryKind, 'head', name);
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

test('a head-sized phrase landing beside a projection of its own category assembled in its stage stays phrasal', () => {
  // [D it [D the [V saw it]]]: the new sister projects the landing's own
  // category, so the landing is its specifier, not a head over a complement.
  const object = leaf('low', 'D', { word: 'it', tokenIndex: 2, lineageId: 'object' });
  const vp = node('oldVP', 'V', [leaf('verb', 'V', { word: 'saw', tokenIndex: 1 }), object]);
  const det = leaf('oldD', 'D', { word: 'the', tokenIndex: 0 });
  const lowerVp = structuredClone(vp);
  Object.assign(find([lowerVp], 'low'), { silent: true });
  delete find([lowerVp], 'low').tokenIndex;
  const movement = recover({
    priorForest: [det, vp],
    currentForest: [node('top', 'D', [leaf('high', 'D', { word: 'it', tokenIndex: 2, lineageId: 'object' }),
      node('dBar', 'D', [structuredClone(det), lowerVp])])],
    relation: { relation: 'An authored dependency', anchors: { source: 'low', landing: 'high' } }
  }).movement;
  assert.deepEqual([movement?.trajectoryKind, movement?.sourceNodeId, movement?.targetNodeId], ['phrasal', 'low', 'high']);
});

test('an assembled complement refuses a non-branching new node', () => {
  for (const [name, mutate] of [
    ['a unary complement over one earlier tree', input => {
      const vBar = find(input.currentForest, 'vBar');
      const [lowerVp, locative] = vBar.children[1].children;
      vBar.children[1] = node('adjoined', 'V', [lowerVp]);
      input.currentForest.push(locative);
    }],
    ['a unary wrapper inside a branching assembly', input => {
      const adjoined = find(input.currentForest, 'adjoined');
      adjoined.children[0] = node('wrap', 'V', [adjoined.children[0]]);
    }]
  ]) {
    const input = assembledComplement(); mutate(input);
    assert.notEqual(recover(input).movement?.trajectoryKind, 'head', name);
  }
});
