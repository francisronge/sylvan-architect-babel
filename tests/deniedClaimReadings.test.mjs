import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf = (id, label, word = id, extra = {}) => ({ id, label, word, ...extra });
const forests = {
  theta: [{ id: 'vp', label: 'VP', children: [leaf('subject', 'DP'), { id: 'vbar', label: "V'", children: [
    leaf('v', 'V'), leaf('object', 'DP'), leaf('pp', 'PP')] }] }],
  feature: [{ id: 'cp', label: 'CP', children: [leaf('who', 'DP'), { id: 'cbar', label: "C'", children: [
    leaf('c', 'C'), { id: 'ip', label: 'IP', children: [leaf('subject', 'NP'), leaf('infl', 'I')] }] }] }],
  caseGovernment: [{ id: 'clause', label: 'IP', children: [leaf('subject', 'DP', 'Mia'), { id: 'ibar', label: 'I′', children: [
    { id: 'inflection', label: 'I⁰', silent: true },
    { id: 'vp', label: 'VP', children: [leaf('verb', 'V', 'read'), leaf('object', 'NP', 'books')] }] }] }],
  control: [{ id: 'tp', label: 'TP', children: [leaf('mia', 'DP', 'Mia'), { id: 'vp', label: 'VP', children: [
    leaf('tried', 'V', 'tried'), { id: 'cp', label: 'CP', children: [
      leaf('pro', 'DP', 'PRO', { silent: true }), leaf('leave', 'VP', 'to leave')] }] }] }]
};
const drawn = (forest, relation) => compileRelationRenderPlan([{ statement: '', stageRecord: '', relations: [relation], workspaceForest: forests[forest] }])
  .frames[0].items.filter(item => item.kind !== 'fallback').map(item => item.kind);

// Each reading this branch adds drew these negated claims on 0cef8c7, which main
// leaves neutral. A word of the name or of a value from the existing denial list
// (`DENIED_OR_UNSET`) keeps them neutral; `concord mismatch` stays neutral because
// concord does not head its name, and since 29 Oct 2026 also because mismatch is
// a denial word.
const negated = [
  ['theta', { relation: 'no theta assignment', anchors: { assigner: 'v', argument: ['object'] }, values: { argument: ['Theme'] } }],
  ['theta', { relation: 'no theta assignment', anchors: { predicate: 'v', agent: 'subject', theme: 'object' }, values: { roles: ['Agent', 'Theme'] } }],
  ['feature', { relation: 'failed spec-head agreement', anchors: { head: 'infl', specifier: 'subject' }, values: { person: '3', number: 'sg' } }],
  ['feature', { relation: 'failed spec-head agreement', anchors: { head: 'c', specifier: 'who' }, values: { feature: '+wh' } }],
  ['feature', { relation: 'concord mismatch', anchors: { controller: 'subject', target: 'infl' }, values: { number: 'sg' } }],
  ['feature', { relation: 'no feature checking', anchors: { head: 'c', specifier: 'who' }, values: { feature: '+wh' } }],
  ['theta', { relation: 'theta assignment not established', anchors: { assigner: 'v', argument: ['object'] }, values: { argument: ['Theme'] } }],
  ['theta', { relation: 'theta assignment not established', anchors: { predicate: 'v', agent: 'subject', theme: 'object' }, values: { roles: ['Agent', 'Theme'] } }]
];

test('a negated claim stays neutral under every reading this branch adds', () => {
  for (const [forest, relation] of negated) assert.deepEqual(drawn(forest, relation), [], relation.relation);
});

test('a denying value keeps the added readings neutral, as a denying name does', () => {
  for (const [forest, relation] of [
    ['theta', { relation: 'theta-marking', anchors: { assigner: 'v', recipient: 'object' }, values: { role: 'Theme', status: 'failed' } }],
    ['theta', { relation: 'UnregisteredAnalysis', anchors: { assigner: 'v', argument: ['object'] }, values: { argument: ['Theme'], status: 'failed' } }],
    ['feature', { relation: 'spec-head agreement', anchors: { head: 'infl', specifier: 'subject' }, values: { person: '3', number: 'sg', status: 'failed' } }],
    ['feature', { relation: 'spec-head agreement', anchors: { head: 'c', specifier: 'who' }, values: { feature: '+wh', checked: 'no' } }],
    ['feature', { relation: 'failed concord', anchors: { controller: 'subject', target: 'infl' }, values: { number: 'sg' } }],
    ['caseGovernment', { relation: 'no government and Case licensing', anchors: { governor: 'verb', governee: 'object' }, values: { case: 'accusative' } }],
    ['control', { relation: 'control', anchors: { controller: 'mia', controllee: 'pro' }, values: { status: 'failed' } }]
  ]) assert.deepEqual(drawn(forest, relation), [], `${relation.relation} ${JSON.stringify(relation.values)}`);
});

test('the same claims stated positively still draw', () => {
  for (const [forest, relation] of [
    ['theta', { relation: 'theta assignment', anchors: { predicate: 'v', agent: 'subject', theme: 'object' }, values: { roles: ['Agent', 'Theme'] } }],
    ['theta', { relation: 'theta-marking', anchors: { assigner: 'v', recipient: 'object' }, values: { role: 'Theme' } }],
    ['feature', { relation: 'spec-head agreement', anchors: { head: 'infl', specifier: 'subject' }, values: { person: '3', number: 'sg' } }],
    ['feature', { relation: 'feature checking', anchors: { head: 'c', specifier: 'who' }, values: { feature: '+wh' } }],
    ['feature', { relation: 'subject-verb concord', anchors: { controller: 'subject', target: 'infl' }, values: { number: 'sg' } }],
    ['caseGovernment', { relation: 'government and Case licensing', anchors: { governor: 'verb', governee: 'object' }, values: { case: 'accusative' } }],
    ['control', { relation: 'control', anchors: { controller: 'mia', controllee: 'pro' } }]
  ]) assert.notDeepEqual(drawn(forest, relation), [], relation.relation);
});

// Each word added to the denial list on 29 Oct 2026 drew its claim on main.
const agreement = { head: 'infl', specifier: 'subject' }, whChecking = { head: 'c', specifier: 'who' };
const deniedByAddedWord = [
  ['mismatch', ['feature', { relation: 'spec-head agreement mismatch', anchors: agreement, values: { person: '3', number: 'sg' } }]],
  ['mismatches', ['feature', { relation: 'spec-head agreement', anchors: agreement, values: { person: '3', number: 'sg', note: 'person mismatches' } }]],
  ['mismatched', ['feature', { relation: 'mismatched spec-head agreement', anchors: whChecking, values: { feature: '+wh' } }]],
  ['violation', ['theta', { relation: 'theta assignment violation', anchors: { predicate: 'v', agent: 'subject', theme: 'object' }, values: { roles: ['Agent', 'Theme'] } }]],
  ['violations', ['theta', { relation: 'theta-marking', anchors: { assigner: 'v', recipient: 'object' }, values: { role: 'Theme', note: 'theta criterion violations' } }]],
  ['violated', ['feature', { relation: 'spec-head agreement', anchors: agreement, values: { person: '3', number: 'sg', status: 'violated' } }]],
  ['violates', ['feature', { relation: 'feature checking', anchors: whChecking, values: { feature: '+wh', note: 'violates the wh-criterion' } }]],
  ['never', ['theta', { relation: 'theta assignment never established', anchors: { assigner: 'v', argument: ['object'] }, values: { argument: ['Theme'] } }]],
  ['lack', ['feature', { relation: 'lack of feature checking', anchors: whChecking, values: { feature: '+wh' } }]],
  ['lacks', ['control', { relation: 'control', anchors: { controller: 'mia', controllee: 'pro' }, values: { status: 'PRO lacks a controller' } }]],
  ['lacking', ['caseGovernment', { relation: 'lacking government and Case licensing', anchors: { governor: 'verb', governee: 'object' }, values: { case: 'accusative' } }]],
  ['unchecked', ['feature', { relation: 'feature checking', anchors: whChecking, values: { feature: '+wh', note: 'the feature remains unchecked' } }]]
];
// The same claim without its denying wording: the name loses the word and the
// value stating it is dropped.
const withoutDenial = ([forest, relation]) => [forest, {
  ...relation,
  relation: relation.relation.replace(/^(?:mismatched |lack of |lacking )|(?: mismatch| violation| never established)$/u, ''),
  values: Object.fromEntries(Object.entries(relation.values).filter(([key]) => key !== 'status' && key !== 'note'))
}];
const describe = ([forest, relation]) => `${forest}: ${relation.relation} ${JSON.stringify(relation.values)}`;

test('each added denial word keeps its claim neutral', () => {
  assert.deepEqual(deniedByAddedWord.filter(([, claim]) => drawn(...claim).length).map(([word]) => word), []);
});

test('the same claims without the added word draw, as do claims with near positive words', () => {
  const positive = [
    ...deniedByAddedWord.map(([, claim]) => withoutDenial(claim)),
    ['feature', { relation: 'spec-head agreement', anchors: agreement, values: { person: '3', number: 'sg', note: 'person checked' } }],
    ['feature', { relation: 'feature checking', anchors: whChecking, values: { feature: '+wh', note: 'the feature is checked' } }],
    ['feature', { relation: 'matching spec-head agreement', anchors: agreement, values: { person: '3', number: 'sg' } }],
    ['feature', { relation: 'spec-head agreement matched', anchors: agreement, values: { person: '3', number: 'sg' } }]
  ];
  assert.deepEqual(positive.filter(claim => !drawn(...claim).length).map(describe), []);
});
