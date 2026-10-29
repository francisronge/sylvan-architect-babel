import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

// V governs its NP sister; the subject DP stands outside VP.
const forest = [{ id: 'clause', label: 'IP', children: [
  { id: 'subject', label: 'DP', word: 'Mia' },
  { id: 'ibar', label: 'I′', children: [
    { id: 'inflection', label: 'I⁰', silent: true },
    { id: 'vp', label: 'VP', children: [
      { id: 'verb', label: 'V', word: 'read' },
      { id: 'object', label: 'NP', word: 'books' }
    ] }
  ] }
] }];
const paths = (relation, currentForest = forest) => compileRelationRenderPlan([
  { statement: '', stageRecord: '', workspaceForest: currentForest, relations: [relation] }
]).frames[0].items.filter(item => item.pathStyle === 'case-assignment');

test('an asserted Case assignment gives its governor the one unnamed nominal it governs', () => {
  const relation = { relation: 'government and Case licensing', anchors: { governor: 'verb', governee: 'object' }, values: { case: 'accusative' } };
  const original = structuredClone(relation);
  assert.deepEqual(paths(relation).map(path => [path.fromNodeId, path.toNodeId, path.label]), [['verb', 'object', 'accusative']]);
  assert.deepEqual(relation, original);
});

test('structure does not supply a recipient the claim or its configuration leaves open', () => {
  const base = { relation: 'government and Case licensing', anchors: { governor: 'verb', governee: 'object' }, values: { case: 'accusative' } };
  for (const relation of [
    { ...base, relation: 'government' },
    { ...base, relation: 'government and Case' },
    { ...base, values: {} },
    { ...base, anchors: { governor: 'verb', governee: 'subject' } },
    { ...base, anchors: { governor: 'verb', governee: 'vp' } },
    { ...base, anchors: { governor: 'verb', governee: 'inflection' } },
    { ...base, anchors: { governor: 'verb', governee: 'object', other: 'subject' } },
    { ...base, anchors: { governor: 'verb', governee: ['object', 'subject'] } }
  ]) assert.deepEqual(paths(relation), [], JSON.stringify(relation));
});
