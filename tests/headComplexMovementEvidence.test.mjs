import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { checkNoEarlyReveal, checkStableConstruction } from './helpers/replayInvariants.mjs';

const head = (id, label, lineageId, children = []) => ({ id, label, lineageId, children });
const recover = input => recoverMovementEvidence(input.relation, input.currentForest, input.priorForest);
const dispatch = input => dispatchRelationClaims({ ...input, stageIndex: 1, relationIndex: 0 });
const find = (forest, id) => forest.flatMap(node => [node, ...flatten(node.children ?? [])]).find(node => node.id === id);
const flatten = forest => forest.flatMap(node => [node, ...flatten(node.children ?? [])]);

test('balanced trailing parenthetical annotations preserve the category and displayed label', () => {
  for (const [label, kind] of [['I (finite, present, third-person singular)', 'head'],
    ['V (future auxiliary, finite)', 'head'], ['NP (embedded subject)', 'phrase'],
    ['V′ (intermediate structure)', 'bar'], ['V (projection)', 'bar']]) {
    assert.equal(readCategoryLabel(label)?.kind, kind, label);
  }
  for (const label of ['V (finite', 'V finite)', 'V ()', 'V (finite) prose', 'VP+T (finite)', 'V+TP (finite)'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

const nestedComplex = () => {
  const lower = head('low', 'T', 'finite', [head('lowV', 'V', 'verb'), head('lowT', 'T', 'tense')]);
  const host = head('host', 'C', undefined);
  return { priorForest: [{ id: 'domain', label: 'TP', children: [structuredClone(lower)] }, structuredClone(host)],
    currentForest: [{ id: 'clause', label: 'CP', children: [head('complex', 'C', undefined,
      [head('high', 'T', 'finite', [head('highV', 'V', 'verb'), head('highT', 'T', 'tense')]), host]),
    { id: 'domain', label: 'TP', children: [{ ...lower, silent: true }] }] }],
    relation: { relation: 'T-to-C head movement', anchors: { lowerHeadOccurrence: 'low', lowerVerbOccurrence: 'lowV',
      lowerTenseOccurrence: 'lowT', higherHeadOccurrence: 'high', higherVerbOccurrence: 'highV',
      higherTenseOccurrence: 'highT', target: 'host' }, priorAnchors: { source: 'low', target: 'host' } } };
};

test('a uniquely prior-bound head complex keeps nested members as context for one exact trajectory', () => {
  const input = nestedComplex(), original = structuredClone(input), movement = recover(input).movement;
  assert.equal(movement?.sourceNodeId, 'low'); assert.equal(movement?.targetNodeId, 'high');
  assert.equal(movement?.trajectoryKind, 'head');
  assert.deepEqual(movement.context.filter(item => item.kind === 'head-member').map(item => item.nodeId).sort(),
    ['lowV', 'lowT', 'highV', 'highT'].sort());
  const result = dispatch(input);
  assert.equal(result.facets.filter(facet => facet.recipe.id === 'movement.path').length, 1);
  assert(!result.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field =>
    field.field === 'anchors' && /(?:Verb|Tense)Occurrence/u.test(field.key))));
  assert.deepEqual(input, original);
});

test('current whole-head endpoints and carried members identify the preceding source without prior anchors', () => {
  const input = nestedComplex(), original = structuredClone(input);
  delete input.relation.priorAnchors;
  const movement = recover(input).movement;
  assert.equal(movement?.priorSourceNodeId, 'low');
  assert.equal(movement?.targetNodeId, 'high');
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(dispatch(input).facets.filter(f => f.recipe.id === 'movement.path').length, 1);
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, i) => ({
    statement: '', stageRecord: '', workspaceForest, relations: i ? [input.relation] : [] }));
  const steps = prepareReplay({ derivationStages: stages, sentence: '', includePlayback: true }).playbackSteps;
  const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
  assert(moment > 0);
  for (const step of steps.slice(0, moment)) {
    for (const id of ['high', 'highV', 'highT']) assert(!step.replayVisibleNodeIds.includes(id), id);
  }
  for (const id of ['high', 'highV', 'highT']) assert(steps[moment].replayVisibleNodeIds.includes(id), id);
  assert.equal(steps[moment].replayRelationLinks.filter(l => l.authoredRelationKey === '1:0').length, 1);
  delete original.relation.priorAnchors;
  assert.deepEqual(input, original);
});

test('current complex endpoints cannot conceal competing sources or invalid carried members', () => {
  for (const mutate of [
    i => { find(i.currentForest, 'high').children.reverse(); },
    i => { find(i.currentForest, 'highV').lineageId = 'unrelated'; },
    i => { find(i.currentForest, 'lowT').lineageId = 'unrelated'; },
    i => { i.currentForest.push(structuredClone(find(i.currentForest, 'highV'))); },
    i => { i.relation.priorAnchors = { source: 'lowV' }; },
    i => { i.relation.anchors.lowerHeadOccurrence = ['low', 'low']; },
    i => { i.relation.anchors.higherHeadOccurrence = ['high', 'high']; },
    i => { i.relation.anchors.lowerOccurrence = 'other'; i.priorForest.push(head('other', 'V', 'other')); i.currentForest.push(head('other', 'V', 'other')); }
  ]) {
    const input = nestedComplex(); delete input.relation.priorAnchors; mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

test('nested head evidence cannot collapse competing, reordered, missing or duplicated members', () => {
  for (const mutate of [
    input => { find(input.currentForest, 'high').children.reverse(); },
    input => { find(input.currentForest, 'highV').lineageId = 'unrelated'; },
    input => { find(input.currentForest, 'highT').label = 'TP'; },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'highV'))); },
    input => { input.priorForest.push(structuredClone(find(input.priorForest, 'lowV'))); },
    input => { input.relation.anchors.higherHeadOccurrence = ['high', 'another']; },
    input => { delete find(input.priorForest, 'low').lineageId; },
    input => { input.relation.anchors.landingOccurrence = 'other'; input.currentForest.push(head('other', 'T', 'finite')); }
  ]) {
    const input = nestedComplex(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

const containedCarrier = () => {
  const verb = { ...head('verb', 'V', 'lexical'), word: 'read' };
  const lowerContainer = head('inflection', 'I', undefined, [verb]);
  return { priorForest: [{ id: 'domain', label: 'IP', children: [structuredClone(lowerContainer)] }],
    currentForest: [{ id: 'clause', label: 'CP', children: [head('complementizer', 'C', undefined, [verb]),
      { id: 'domain', label: 'IP', children: [head('inflection', 'I', undefined,
        [head('trace', 'V', 'lexical')])] }] }],
    relation: { relation: 'I-to-C head movement', anchors: { movedHead: 'verb', sourceTrace: 'trace', landingHead: 'complementizer' },
      priorAnchors: { sourceHead: 'inflection', containedVerb: 'verb' } } };
};

test('a lineage-free prior head container scopes its one explicitly anchored lexical carrier', () => {
  const input = containedCarrier(), original = structuredClone(input), movement = recover(input).movement;
  assert.equal(movement?.priorSourceNodeId, 'verb');
  assert.equal(movement?.sourceNodeId, 'trace'); assert.equal(movement?.targetNodeId, 'verb');
  assert(movement?.priorContextKeys.includes('sourceHead'));
  assert(!movement?.priorAnchorKeys?.includes('sourceHead'));
  const result = dispatch(input);
  const container = result.evidenceCoverage.fields.find(field => field.field === 'priorAnchors' && field.key === 'sourceHead');
  assert.deepEqual(container.unrecoveredItemIndices, []);
  const listed = structuredClone(input); listed.relation.priorAnchors.sourceHead = ['inflection'];
  assert.deepEqual(dispatch(listed).evidenceCoverage.fields.find(field => field.field === 'priorAnchors' && field.key === 'sourceHead')
    .unrecoveredItemIndices, []);
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, index) => ({
    statement: '', stageRecord: '', workspaceForest, relations: index ? [input.relation] : [] }));
  const paths = compileRelationRenderPlan(stages).frames[1].items.filter(item => item.kind === 'trajectory');
  assert.equal(paths.length, 1); assert.equal(paths[0].sourceNodeId, 'trace'); assert.equal(paths[0].targetNodeId, 'verb');
  assert.deepEqual(input, original);
});

test('prior container evidence requires unique member identity, exact preceding slot and head paths', () => {
  for (const mutate of [
    input => { find(input.priorForest, 'inflection').label = 'IP'; },
    input => { delete find(input.priorForest, 'verb').lineageId; },
    input => { find(input.currentForest, 'trace').lineageId = 'different'; },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'trace'))); },
    input => { input.priorForest.push(structuredClone(find(input.priorForest, 'verb'))); },
    input => { input.priorForest = []; },
    input => { find(input.currentForest, 'inflection').children.unshift(head('other', 'Agr', 'other')); }
  ]) {
    const input = containedCarrier(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

test('head recovery preserves the malformed exact Tier 1 primary guard', () => {
  // A target that is neither the landing nor its host or complex competes with
  // the named landing, so the exact claim stays malformed and Tier 2 does not
  // repair it.
  const input = nestedComplex(); input.relation.relation = 'Head movement';
  input.relation.anchors.target = 'clause';
  const result = dispatch(input);
  assert.equal(result.primaryClaim.tier, 3);
  assert(!result.facets.some(facet => facet.recipe.id === 'movement.path'));
  // The C head the complex adjoins to is that landing's host, not a second landing.
  input.relation.anchors.target = 'host';
  assert.equal(dispatch(input).primaryClaim.tier, 1);
});

test('generic Tier 1 landing-head context can name the exact complex without loosening explicit host roles', () => {
  const low = head('low', 'V', 'verb'), host = head('host', 'v', undefined);
  const input = { priorForest: [{ id: 'domain', label: 'VP', children: [structuredClone(low)] }, structuredClone(host)],
    currentForest: [{ id: 'phrase', label: 'vP', children: [head('complex', 'v', undefined,
      [host, head('high', 'V', 'verb')]), { id: 'domain', label: 'VP', children: [low] }] }],
    relation: { relation: 'head movement', anchors: { lowerOccurrence: 'low', higherOccurrence: 'high', landingHead: 'complex' },
      priorAnchors: { source: 'low', target: 'host' } } };
  assert.equal(dispatch(input).primaryClaim.tier, 1);
  for (const anchors of [{ ...input.relation.anchors, landingHead: 'phrase' },
    { lowerOccurrence: 'low', higherOccurrence: 'high', hostHead: 'complex' },
    { lowerOccurrence: 'low', landingHead: 'complex' }])
    assert.equal(dispatch({ ...input, relation: { ...input.relation, anchors } }).primaryClaim.tier, 3);
  assert.equal(dispatch({ ...input, currentForest: [...input.currentForest, structuredClone(input.currentForest[0].children[0])] }).primaryClaim.tier, 3);
});

const displacedAssembly = () => {
  const carried = { ...head('carried', 'V⁰', 'verb'), word: 'stem' };
  const exponent = { ...head('exponent', 'T⁰', undefined), silent: true };
  const old = head('old', 'T⁰', 'assembly', [carried, exponent]);
  const host = { ...head('host', 'C⁰', undefined), silent: true };
  const domain = { id: 'domain', label: 'T′', children: [head('predicate', 'VP', undefined), old] };
  return {
    priorForest: [{ id: 'clause', label: 'C′', children: [host, domain] }],
    currentForest: [{ id: 'clause', label: 'C′', children: [
      head('receiving', 'C⁰', undefined, [{ ...structuredClone(old), id: 'new' }, structuredClone(host)]),
      { ...structuredClone(domain), children: [head('predicate', 'VP', undefined),
        { ...head('old', 't_T', 'assembly'), silent: true }] }
    ] }],
    relation: { relation: 'An authored relation',
      anchors: { itemOne: 'new', itemTwo: 'old', landingHead: 'receiving', containedMaterial: 'carried' },
      priorAnchors: { earlierObject: 'old' }, values: { explanation: 'Keep this exact text.' } }
  };
};

test('an intact prior head assembly adjoined at an explicit receiving head supplies structural endpoints', () => {
  const input = displacedAssembly(), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.sourceNodeId, 'old');
  assert.equal(movement?.targetNodeId, 'new');
  assert.equal(movement?.priorSourceNodeId, 'old');
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(movement?.transition, true);
  const result = dispatch(input);
  assert.equal(result.facets.filter(facet => facet.recipe.id === 'movement.path').length, 1);
  assert(result.claims.some(claim => claim.tier === 3 && claim.consumedEvidence.some(field =>
    field.field === 'values' && field.key === 'explanation')));
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, index) => ({
    statement: '', stageRecord: '', workspaceForest, relations: index ? [input.relation] : [] }));
  const paths = compileRelationRenderPlan(stages).frames[1].items.filter(item => item.kind === 'trajectory');
  assert.equal(paths.length, 1);
  assert.equal(paths[0].sourceNodeId, 'old'); assert.equal(paths[0].targetNodeId, 'new');
  assert.deepEqual(input, original);
});

test('an open endpoint field cannot borrow head-adjunction evidence from changed or ambiguous structure', () => {
  for (const mutate of [
    input => { delete input.relation.priorAnchors; },
    input => { input.relation.priorAnchors.earlierObject = ['old', 'old']; },
    input => { input.relation.priorAnchors.earlierObject = ['old', 'host']; },
    input => { input.relation.anchors.otherContext = input.relation.anchors.landingHead; delete input.relation.anchors.landingHead; },
    input => { input.relation.anchors.itemOne = ['new', 'new']; },
    input => { input.relation.anchors.itemTwo = ['old', 'old']; },
    input => { find(input.currentForest, 'receiving').label = 'CP'; },
    input => { find(input.currentForest, 'new').lineageId = 'unrelated'; },
    input => { find(input.currentForest, 'old').lineageId = 'unrelated'; },
    input => { find(input.currentForest, 'carried').word = 'changed'; },
    input => { find(input.currentForest, 'new').silent = true; },
    input => { find(input.currentForest, 'new').children.reverse(); },
    input => { find(input.currentForest, 'domain').children.reverse(); },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'carried'))); },
    input => { input.priorForest.push(structuredClone(find(input.priorForest, 'exponent'))); },
    input => { input.currentForest.push(structuredClone(find(input.currentForest, 'old'))); },
    input => { input.priorForest = structuredClone(input.currentForest); },
    input => { input.relation.anchors.landingOccurrence = 'unresolved'; }
  ]) {
    const input = displacedAssembly(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
    assert(!dispatch(input).facets.some(facet => facet.recipe.id === 'movement.path'), mutate.toString());
  }
});

test('structural head adjunction does not rescue malformed registered movement claims', () => {
  const input = displacedAssembly(); input.relation.relation = 'Head movement';
  assert(!dispatch(input).facets.some(facet => facet.recipe.id === 'movement.path'));
});

test('intact head assemblies compare authored fields independently of JSON property order', () => {
  const input = displacedAssembly();
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  input.currentForest = reorder(input.currentForest);
  assert.equal(recover(input).movement?.targetNodeId, 'new');
});

test('one whole-head trace can replace a complex while exact carried members remain movement context', () => {
  const fixture = () => {
    const input = nestedComplex();
    find(input.currentForest, 'domain').children = [{ id: 'low', label: 'T⁰ [trace]', lineageId: 'finite', silent: true }];
    input.relation.anchors = { sourceTrace: 'low', raisedFiniteHead: 'high', raisedVerb: 'highV', landingHead: 'complex' };
    input.relation.priorAnchors = { sourceFiniteHead: 'low', sourceVerb: 'lowV' };
    return input;
  };
  const input = fixture(), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.sourceNodeId, 'low');
  assert.equal(movement?.targetNodeId, 'high');
  assert(movement.context.some(c => c.nodeId === 'highV' && c.kind === 'head-member'));
  assert.equal(dispatch(input).facets.filter(f => f.recipe.id === 'movement.path').length, 1);
  assert.deepEqual(input, original);
  for (const mutate of [
    i => { find(i.currentForest, 'highV').word = 'changed'; },
    i => { find(i.currentForest, 'highV').lineageId = 'different'; },
    i => { find(i.currentForest, 'high').children.reverse(); },
    i => { i.currentForest.push(structuredClone(find(i.currentForest, 'highV'))); },
    i => { delete find(i.priorForest, 'low').lineageId; },
    i => { find(i.currentForest, 'low').label = 'TP'; }
  ]) {
    const i = fixture(); mutate(i);
    assert.equal(recover(i).movement, undefined, mutate.toString());
  }
});

const carriedAssembly = () => {
  const input = displacedAssembly();
  input.currentForest[0].children[1].children[1].id = 'foot';
  input.relation.anchors = { firstObject: 'new', secondObject: 'foot', landingHead: 'receiving', member: 'carried' };
  input.relation.priorAnchors = { previousAssembly: 'old', previousMember: 'carried', previousReceiver: 'host' };
  return input;
};

test('an intact moved assembly disambiguates an anchored carried member in a renamed parent', () => {
  const input = carriedAssembly(), original = structuredClone(input);
  const movement = recover(input).movement;
  assert.equal(movement?.priorSourceNodeId, 'old');
  assert.equal(movement?.sourceNodeId, 'foot');
  assert.equal(movement?.targetNodeId, 'new');
  assert.equal(movement?.trajectoryKind, 'head');
  assert.equal(dispatch(input).facets.filter(f => f.recipe.id === 'movement.path').length, 1);
  const stages = [input.priorForest, input.currentForest].map((workspaceForest, i) => ({
    statement: '', stageRecord: '', workspaceForest, relations: i ? [input.relation] : [] }));
  const replay = prepareReplay({ derivationStages: stages, sentence: 'stem', includePlayback: true });
  const moment = replay.playbackSteps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
  assert(moment > 0);
  const before = replay.playbackSteps[moment - 1], after = replay.playbackSteps[moment];
  assert(before.replayVisibleNodeIds.includes('old'));
  assert(before.replayVisibleNodeIds.includes('carried'));
  assert(!before.replayVisibleNodeIds.includes('new'));
  assert(!before.replayVisibleNodeIds.includes('foot'));
  assert(after.replayVisibleNodeIds.includes('new'));
  assert(after.replayVisibleNodeIds.includes('foot'));
  assert(after.replayVisibleNodeIds.includes('carried'));
  assert.equal(after.replayRelationLinks.filter(l => l.authoredRelationKey === '1:0').length, 1);
  assert.deepEqual(input, original);
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reverse(v)])) : value;
  assert.equal(recover(reverse(input)).movement?.targetNodeId, 'new');
});

test('carried-member context requires the intact assembly proof and cannot erase an explicit source', () => {
  for (const mutate of [
    i => { find(i.currentForest, 'new').children.reverse(); },
    i => { find(i.currentForest, 'carried').word = 'changed'; },
    i => { find(i.currentForest, 'foot').lineageId = 'unrelated'; },
    i => { i.currentForest.push(structuredClone(find(i.currentForest, 'carried'))); },
    i => { i.relation.priorAnchors.source = 'carried'; },
    i => { delete i.relation.anchors.landingHead; },
    i => { i.relation.priorAnchors.previousAssembly = ['old', 'old']; },
    i => { find(i.currentForest, 'receiving').label = 'CP'; }
  ]) {
    const input = carriedAssembly(); mutate(input);
    assert.equal(recover(input).movement, undefined, mutate.toString());
  }
});

// A raised v complex adjoins T under a parent whose compound label bundles
// both heads; the host is T, whichever member the label spells first.
const compoundComplex = label => {
  const verbal = (id, verbId, lightId, silent) => head(id, 'v', 'complexVerb', [
    { id: verbId, label: 'V', word: 'read', lineageId: 'verb', ...(silent && { silent: true }) },
    { id: lightId, label: 'v', lineageId: 'light', silent: true }]);
  const vp = lower => ({ id: 'vp', label: 'v', children: [lower,
    { id: 'object', label: 'D', children: [{ id: 'objectNoun', label: 'N', word: 'books' }] }] });
  const tense = { id: 'tense', label: 'T', silent: true };
  return {
    priorForest: [structuredClone(tense), vp(verbal('lowComplex', 'lowVerb', 'lowLight'))],
    currentForest: [{ id: 'clause', label: 'T', children: [
      { id: 'complex', label, children: [verbal('highComplex', 'highVerb', 'highLight'), structuredClone(tense)] },
      vp({ ...verbal('lowComplex', 'lowVerb', 'lowLight', true), silent: true })] }],
    relation: { relation: 'head movement', anchors: { complexHead: 'complex', higherOccurrence: 'highComplex',
      host: 'tense', source: 'lowComplex' }, priorAnchors: { source: 'lowComplex' } }
  };
};
const compoundStages = input => [input.priorForest, input.currentForest].map((workspaceForest, i) => ({
  statement: '', stageRecord: '', workspaceForest, relations: i ? [input.relation] : [] }));

test('a compound complex label that bundles its host category proves head adjunction in either member order', () => {
  for (const label of ['T', 'v+T', 'T+v', 'v⁰+T⁰', 'V+v+T', 'v/T']) {
    const input = compoundComplex(label), original = structuredClone(input);
    const result = recover(input);
    assert.deepEqual([result.movement?.sourceNodeId, result.movement?.targetNodeId, result.movement?.trajectoryKind],
      ['lowComplex', 'highComplex', 'head'], label);
    assert.deepEqual(result.diagnostics.filter(item => item.startsWith('MOVEMENT_CONTEXT_UNPROVEN')), [], label);
    const stages = compoundStages(input);
    const steps = prepareReplay({ derivationStages: stages, sentence: 'read books', includePlayback: true }).playbackSteps;
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
    assert(moment > 0, label);
    for (const step of steps.slice(0, moment))
      for (const id of ['complex', 'highComplex', 'highVerb', 'highLight'])
        assert(!step.replayVisibleNodeIds.includes(id), `${label}: ${id} waits for the head movement`);
    for (const id of ['complex', 'highComplex', 'highVerb', 'highLight'])
      assert(steps[moment].replayVisibleNodeIds.includes(id), `${label}: ${id} arrives with the head movement`);
    assert.equal(find([steps[moment - 1].replayCanvasData], 'lowVerb').silent, undefined, `${label}: the source keeps its word until the moment`);
    assert(steps[moment].replayRelationLinks.some(link => link.authoredRelationKey === '1:0'
      && link.trajectoryKind === 'head' && link.sourceNodeId === 'lowComplex' && link.targetNodeId === 'highComplex'), label);
    assert(compileRelationRenderPlan(stages).frames[1].items.some(item => item.kind === 'trajectory'
      && item.trajectoryKind === 'head' && item.targetNodeId === 'highComplex'), label);
    assert.deepEqual(input, original, label);
  }
});

test('two occurrences of one moved complex name the same head when one spells its members', () => {
  for (const label of ['V+v', 'v+V']) {
    const input = compoundComplex('T');
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'lowComplex').label = label;
    const movement = recover(input).movement;
    assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind],
      ['lowComplex', 'highComplex', 'head'], label);
  }
});

test('a complex spelled by its members still heads the projection it leaves', () => {
  for (const label of ['V+v', 'v+V']) {
    // Without a named receiving head, the source's preceding head slot proves the head reading.
    const input = compoundComplex('T');
    input.relation.anchors = { higherOccurrence: 'highComplex', source: 'lowComplex' };
    for (const forest of [input.priorForest, input.currentForest]) find(forest, 'lowComplex').label = label;
    const movement = recover(input).movement;
    assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind],
      ['lowComplex', 'highComplex', 'head'], label);
  }
});

test('a compound complex label must still name its host category', () => {
  for (const label of ['v', 'V+v', 'D+v', 'C+v', 'Tense']) {
    const input = compoundComplex(label), result = recover(input);
    assert.notEqual(result.movement?.trajectoryKind, 'head', label);
    assert(result.diagnostics.some(item => item.startsWith('MOVEMENT_CONTEXT_UNPROVEN') && item.includes('anchors.complexHead')), label);
    // The refused head movement stays a neutral claim; its moment still
    // introduces the complex, and no construction step shows it earlier.
    const prepared = prepareReplay({ derivationStages: compoundStages(input), sentence: 'read books', includePlayback: true });
    const steps = prepared.playbackSteps;
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
    for (const step of steps.slice(0, moment))
      assert(!step.replayVisibleNodeIds.includes('highComplex'), `${label}: the landing waits for its moment`);
    assert(steps[moment].replayVisibleNodeIds.includes('highComplex'), label);
    assert.deepEqual([checkNoEarlyReveal(prepared), checkStableConstruction(prepared)].flat(), [], label);
  }
});
