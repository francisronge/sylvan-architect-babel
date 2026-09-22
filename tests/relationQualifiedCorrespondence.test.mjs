import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const forest = [{ id: 'r8', label: 'XP', children: [
  { id: 'n2', label: 'YP', children: [{ id: 'n3', label: 'Y', word: 'a' }] },
  { id: 'q7', label: 'ZP', children: [{ id: 'q9', label: 'Z', word: 'a', silent: true }] },
  { id: 'w4', label: 'K', word: 'b' }
] }];
const dispatch = r => dispatchRelationClaims({ relation: r, currentForest: forest, stageIndex: 0, relationIndex: 0 });
const has = (r, id) => dispatch(r).facets.some(f => f.recipe.id === id);

test('particle association draws only its authored endpoints without inventing prosody', () => {
  for (const particle of ['particle', 'focusParticle', 'association_particle', 'additive', 'additiveParticle']) {
    for (const associate of ['associate', 'focusAssociate', 'associated-constituent']) {
      const r = { relation: 'An independently named claim', anchors: { [associate]: 'n2', [particle]: 'w4', focusedConstituent: 'r8' },
        values: { interpretation: 'Authored semantic context.' } };
      const original = structuredClone(r);
      const d = dispatch(r);
      assert(d.facets.some(f => f.recipe.id === 'focus.association'));
      assert(!d.facets.some(f => ['focus.prominence', 'focus.projection', 'strong-npi'].includes(f.recipe.id)));
      const items = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Context', workspaceForest: forest, relations: [r] }]).frames[0].items;
      const link = items.find(item => item.familyId === 'focus.association');
      assert.deepEqual(link.pairs, [{ fromNodeId: 'w4', toNodeId: 'n2' }]);
      assert.deepEqual(link.relationRef.anchors, r.anchors);
      assert(items.some(item => item.kind === 'fallback' && item.relationRef.values.interpretation === r.values.interpretation));
      assert.deepEqual(r, original);
    }
  }
  for (const anchors of [
    { particle: 'w4', associate: 'w4' }, { particle: 'w4', associate: 'missing' },
    { particle: ['w4', 'q7'], associate: 'n2' }, { particle: 'w4', associate: ['n2', 'q7'] },
    { particle: 'w4', associate: 'n2', focusAssociate: 'q7' },
    { left: 'w4', right: 'n2' }, { particle: 'w4', focusedConstituent: 'n2' }
  ]) assert(!has({ relation: 'Focus association', anchors, values: { description: 'The particle associates with the focus.' } }, 'focus.association'), JSON.stringify(anchors));
});

test('operator and variable occurrence qualifiers keep their explicit binding roles', () => {
  for (const operator of ['operatorOccurrence', 'quantifierOccurrence', 'quantifierPosition']) {
    for (const variable of ['variableOccurrence', 'boundVariablePosition']) {
      const r = { relation: 'Unfamiliar', anchors: { [variable]: 'q7', [operator]: 'n2' }, values: { explanation: 'Preserve this text.' } };
      assert(has(r, 'operator-binding'));
      assert(!has({ ...r, anchors: { [variable]: 'n2', [operator]: 'n2' } }, 'operator-binding'));
      assert(!has({ ...r, anchors: { [variable]: 'q7', [operator]: ['n2', 'w4'] } }, 'operator-binding'));
      assert(!has({ ...r, anchors: { participant: 'q7', [operator]: 'n2' } }, 'operator-binding'));
    }
  }
  assert(!has({ relation: 'Quantifier-variable binding', anchors: { left: 'n2', right: 'q7' } }, 'operator-binding'));
});

test('an antecedent and an explicitly deleted domain earn correspondence without prescribing deletion', () => {
  for (const antecedent of ['antecedentDomain', 'antecedent']) for (const target of ['ellipsisDomain', 'deletedDomain']) {
    const r = { relation: 'Unfamiliar', anchors: { [target]: 'q7', [antecedent]: 'n2' } };
    assert(has(r, 'correspondence.alignment'));
    assert(has(r, 'ellipsis.site'));
    assert(!has({ ...r, anchors: { [target]: ['q7', 'w4'], [antecedent]: ['n2', 'w4'] } }, 'correspondence.alignment'));
    assert(!has({ ...r, anchors: { domain: 'q7', [antecedent]: 'n2' } }, 'correspondence.alignment'));
  }
});

test('pronounced and interpreted occurrence lists pair by root lineage, never array position', () => {
  const currentForest = [{ id: 'r', label: 'CP', children: [
    { id: 'h7', label: 'DP', lineageId: 'first' }, { id: 'h2', label: 'DP', lineageId: 'second' },
    { id: 'k9', label: 'DP', lineageId: 'first' }, { id: 'k1', label: 'DP', lineageId: 'second' }
  ] }];
  const r = { relation: 'An unfamiliar name', anchors: { interpretedArguments: ['k1', 'k9'], pronouncedArguments: ['h7', 'h2'], pronunciationBranch: 'r' },
    values: { architecture: 'Authored interpretation context.' } };
  const input = { relation: r, currentForest, stageIndex: 0, relationIndex: 0 };
  const d = dispatchRelationClaims(input);
  assert.equal(d.facets.filter(f => f.recipe.id === 'correspondence.alignment').length, 2);
  for (const key of ['interpretedArguments', 'pronouncedArguments']) {
    assert.deepEqual(d.evidenceCoverage.fields.find(field => field.key === key).unrecoveredItemIndices, []);
  }
  const items = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Context', workspaceForest: currentForest, relations: [r] }]).frames[0].items;
  assert.deepEqual(items.filter(item => item.kind === 'undirected-link').flatMap(item => item.pairs), [
    { fromNodeId: 'h7', toNodeId: 'k9' }, { fromNodeId: 'h2', toNodeId: 'k1' }
  ]);
  assert(!d.facets.some(f => f.recipe.id === 'movement.path'));
  for (const mutate of [
    x => { delete x.currentForest[0].children[2].lineageId; },
    x => { x.currentForest[0].children[3].lineageId = 'first'; },
    x => { x.relation.anchors.interpretedArguments = ['k1']; },
    x => { x.relation.anchors.interpretedArguments = ['k1', 'missing']; },
    x => { x.relation.anchors.lfArguments = ['k9', 'k1']; }
  ]) {
    const copy = structuredClone(input); mutate(copy);
    assert(!dispatchRelationClaims(copy).facets.some(f => f.recipe.id === 'correspondence.alignment'));
  }
});

test('a named intervening participant and negative judgment earn the blocked path', () => {
  for (const role of ['interveningOperator', 'interveningHead', 'interveningPhrase']) {
    const r = { relation: 'Unfamiliar', anchors: { [role]: 'w4', landing: 'n2', source: 'q7' },
      values: { judgment: 'nonconvergent', explanation: 'The authored context.' } };
    assert(has(r, 'intervention'));
    const items = compileRelationRenderPlan([{ statement: 'State', stageRecord: 'Context', workspaceForest: forest, relations: [r] }]).frames[0].items;
    const path = items.find(item => item.pathStyle === 'intervention');
    assert.equal(path.outcome, 'blocked');
    assert.equal(path.fromNodeId, 'n2'); assert.equal(path.toNodeId, 'q7');
    assert(items.some(item => item.kind === 'fallback' && item.relationRef.values.explanation === 'The authored context.'));
    for (const values of [undefined, { judgment: 'grammatical' }, { explanation: 'This is blocked.' }]) assert(!has({ ...r, values }, 'intervention'));
    assert(!has({ ...r, anchors: { landing: 'n2', source: 'q7' } }, 'intervention'));
    assert(!has({ ...r, anchors: { [role]: ['w4', 'r8'], landing: 'n2', source: 'q7' } }, 'intervention'));
  }
});
