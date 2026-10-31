import assert from 'node:assert/strict';
import test from 'node:test';

import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { readStructuralProjections, writesProjectionLevels } from '../replay/projectionStructure.ts';
import { readStructuralHeads } from '../replay/structuralHeads.ts';
import { structuralSignature } from '../replay/relations/structuralSignature.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

// Minimalist label notations the category reader once left unread or misread
// (minimalism audit, finding 5). Sources are in replay/categoryLabel.ts.
const leaf = (id, label, extra = {}) => ({ id, label, children: [], ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const find = (forest, id) => {
  for (const root of forest) {
    if (root.id === id) return root;
    const hit = find(root.children ?? [], id);
    if (hit) return hit;
  }
};
const reading = label => {
  const shape = readCategoryLabel(label);
  return shape && { kind: shape.kind, head: shape.head, labelling: shape.labelling, members: shape.members };
};

test('a shared-feature label reads as a phrase with no head category', () => {
  for (const label of ['⟨φ,φ⟩', '<φ,φ>', '⟨Q, Q⟩', '〈φ,φ〉', '⟨φ,φ⟩: subject agreement'])
    assert.deepEqual(reading(label), { kind: 'phrase', head: '', labelling: 'shared-feature', members: [] }, label);
  for (const label of ['⟨φ,Q⟩', '⟨DP⟩', '⟨φ⟩', '⟨φ,φ'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

test('set notation reads as an unlabelled phrase unless it may be a complex head or names its label', () => {
  for (const label of ['{T, vP}', '{DP, vP}', '{T[uφ:_], vP}', '{DP, {T, vP}}', '{⟨φ,φ⟩, CP}', '{<φ,φ>, CP}'])
    assert.deepEqual(reading(label), { kind: 'phrase', head: '', labelling: 'unlabelled', members: [] }, label);
  // {v, V} may be a complex head; {T, {T, vP}} is Chomsky's 1995 labelled set.
  for (const label of ['{v, V}', '{T, {T, vP}}', '{T, vP, DP}', '{the, cat}', '{uφ}', '{T, vP'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

test('α, β, γ and δ are unlabelled objects, not heads of category α', () => {
  for (const label of ['α', 'β', 'γ', 'δ', 'α (unlabelled)'])
    assert.deepEqual(reading(label), { kind: 'phrase', head: '', labelling: 'unlabelled', members: [] }, label);
});

test('a root is an acategorial terminal and √P its phrase', () => {
  for (const label of ['√EAT', '√', '√eat[+V]', '√207', '√STOP', '√PUT'])
    assert.deepEqual(reading(label), { kind: 'head', head: '√', labelling: 'root', members: ['√'] }, label);
  assert.deepEqual(reading('√P'), { kind: 'phrase', head: '√', labelling: 'root', members: ['√'] });
  assert.deepEqual(reading('√′'), { kind: 'bar', head: '√', labelling: 'root', members: ['√'] });
  assert.deepEqual(reading('√EAT+v'), { kind: 'head', head: '√', labelling: 'root', members: ['√', 'v'] });
  assert.deepEqual(reading('v+√EAT'), { kind: 'head', head: 'v', labelling: undefined, members: ['v', '√'] });
});

test('features in braces annotate the category, as brackets do', () => {
  for (const [label, kind, head] of [['T{uφ}', 'head', 'T'], ['T{uφ, EPP}', 'head', 'T'], ['T{uφ}[past]', 'head', 'T'],
    ['v*{uφ}', 'head', 'v'], ['TP{uφ}', 'phrase', 'T'], ['T[uφ:_]', 'head', 'T']])
    assert.deepEqual(reading(label), { kind, head, labelling: undefined, members: [head] }, label);
});

// [⟨φ,φ⟩ she [T will [v she [v v eat]]]]: a labeling-algorithm clause in bare labels.
const labelledClause = () => [node('pair', '⟨φ,φ⟩', [
  leaf('subj', 'D', { word: 'she', lineageId: 'she' }),
  node('tp', 'T', [leaf('t', 'T{uφ}', { word: 'will' }),
    node('vp', 'v', [leaf('subjLow', 'D', { silent: true, lineageId: 'she' }),
      node('vbar', 'v', [leaf('v', 'v', { silent: true }), leaf('eat', 'V', { word: 'eat' })])])])])];

test('a shared-feature set is phrasal and keeps the bare structural reader', () => {
  const forest = labelledClause(), at = id => find(forest, id);
  assert.equal(writesProjectionLevels(forest), false, '⟨φ,φ⟩ writes no level, so structure decides');
  const levels = readStructuralProjections(forest);
  assert.equal(levels.minimal(at('pair')), false, 'a set of two phrases is not a head');
  assert.equal(levels.category(at('pair')), undefined);
  assert.equal(levels.maximal(at('tp')), true, 'T does not project the shared-feature set');
  assert.equal(levels.positionKind(at('subj')), 'phrasal', 'the subject is one of two phrases');
  assert.equal(levels.projects(at('t'), at('tp')), true, 'T{uφ} heads its projection');
  assert.equal(readStructuralHeads(forest).isHead(at('pair')), false);
});

test('an unlabelled α is not read as a head', () => {
  const forest = [node('alpha', 'α', [node('dp', 'D', [leaf('the', 'D', { word: 'the' }), leaf('cat', 'N', { word: 'cat' })]),
    node('vp', 'v', [leaf('v', 'v', { silent: true }), leaf('sleep', 'V', { word: 'sleeps' })])])];
  const levels = readStructuralProjections(forest);
  assert.equal(levels.minimal(forest[0]), false);
  assert.equal(levels.category(forest[0]), undefined);
  assert.equal(readStructuralHeads(forest).isHead(forest[0]), false);
});

test('two unlabelled sets never share a category', () => {
  const forest = [node('alpha', 'α', [node('set', '{DP, vP}', [leaf('d', 'DP', { word: 'it' }), leaf('vp', 'vP', { word: 'rains' })]),
    leaf('c', 'C', { word: 'that' })])];
  const facts = structuralSignature({ relation: { anchors: { inner: 'set' } }, currentForest: forest }).nodes.set;
  assert.equal(facts.sameCategoryAsParent, false);
  assert.equal(facts.segmentOfParent, false);
  assert.equal(facts.category, undefined);
});

test('a root raising into its categorizing v is head movement', () => {
  const prior = [node('vp', 'v', [leaf('v', 'v', { silent: true }), leaf('root', '√EAT', { word: 'eat', lineageId: 'eat' })])];
  const current = [node('vp', 'v', [node('vcx', 'v', [leaf('root', '√EAT', { word: 'eat', lineageId: 'eat' }), leaf('v', 'v', { silent: true })]),
    leaf('rootLow', '√EAT', { silent: true, lineageId: 'eat' })])];
  const relation = { relation: 'head-movement', anchors: { mover: 'root', lowerCopy: 'rootLow', host: 'v' } };
  const { movement, failure } = recoverMovementEvidence(relation, current, prior);
  assert.equal(failure, undefined);
  assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind], ['rootLow', 'root', 'head']);
});
