import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { bindRelationPlanFrame } from '../replay/relations/geometryBinding.ts';

const saved = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/pf-correspondence-evidence.json', import.meta.url))).examples;
const realizationCases = saved.filter(example => example.id.includes('japanese'));
const correspondenceCases = saved.filter(example => example.id.includes('spanish'));
const inspect = example => {
  const stage = example.stage, relation = stage.relations[example.relationIndex];
  const dispatch = dispatchRelationClaims({ relation, currentForest: stage.workspaceForest,
    currentRealizations: stage.realizations, stageIndex: 0, relationIndex: example.relationIndex });
  const items = compileRelationRenderPlan([stage]).frames[0].items;
  return { dispatch, items: items.filter(item => item.relationRef.relationIndex === example.relationIndex) };
};
const plates = example => inspect(example).items.filter(item => item.kind === 'node-plaque' && item.plaqueStyle === 'realization');
const pairs = example => inspect(example).items.filter(item => item.kind === 'undirected-link').flatMap(item => item.pairs);

test('saved ordered surface tokens draw one PF plate owned by the complete exact group', () => {
  for (const example of realizationCases) {
    const original = structuredClone(example), relation = example.stage.relations[example.relationIndex];
    const result = inspect(example), plate = plates(example);
    assert.equal(plate.length, 1, example.id);
    assert.deepEqual(plate[0].anchorNodeIds, Object.values(relation.anchors));
    assert.deepEqual(plate[0].rows, relation.values.surfaceTokens.map(value => ({ label: 'surfaceTokens', value })));
    assert(plate[0].realizationRowKinds.every(kind => kind === 'literal'));
    assert.deepEqual(result.dispatch.evidenceCoverage.fields.find(field => field.key === 'surfaceTokens').unrecoveredItemIndices, []);
    assert.deepEqual(result.dispatch.evidenceCoverage.fields.find(field => field.key === 'process').unrecoveredItemIndices, [0]);
    assert(!result.items.some(item => ['trajectory', 'directed-path'].includes(item.kind)), 'joint realization is not head movement or a rewrite');
    assert.deepEqual(example, original);
  }
});

test('plural token spellings require the exact association rather than a realization name or lexical stem', () => {
  for (const field of ['surfaceTokens', 'surface_tokens', 'inputTokens']) {
    const input = structuredClone(realizationCases[0]), relation = input.stage.relations[input.relationIndex];
    relation.values = { [field]: relation.values.surfaceTokens };
    assert.equal(plates(input).length, 1);
    for (const mutate of [
      x => { delete x.stage.realizations; },
      x => { x.stage.realizations[0].nodeIds.pop(); },
      x => { x.stage.realizations.push(structuredClone(x.stage.realizations[0])); },
      x => { x.stage.realizations[0].tokenIndices.pop(); },
      x => { x.stage.realizations.push({ nodeIds: [Object.values(relation.anchors)[0]], tokenIndices: [4] }); },
      x => { x.stage.relations[x.relationIndex].values[field][1] = ''; },
      x => { delete x.stage.relations[x.relationIndex].anchors.tense; },
      x => { x.stage.relations[x.relationIndex].anchors.tense = 'missing'; }
    ]) {
      const changed = structuredClone(input); mutate(changed);
      assert.equal(plates(changed).length, 0, `${field}: ${mutate}`);
    }
    const competing = structuredClone(input);
    competing.stage.relations[competing.relationIndex].values.surfaceForm = 'independent lexical form';
    assert(!plates(competing).some(plate => plate.rows.some(row => row.label === field)), 'a competing surface value cannot complete the token-group claim');
    assert.deepEqual(inspect(competing).dispatch.evidenceCoverage.fields.find(entry => entry.key === field).unrecoveredItemIndices, [0, 1, 2]);
  }
});

test('saved PF/LF arrays preserve unique families while the ambiguous verb family remains neutral', () => {
  for (const example of correspondenceCases) {
    const original = structuredClone(example), result = inspect(example);
    assert.deepEqual(pairs(example), [
      { fromNodeId: 'sub', toNodeId: 'lsub' }, { fromNodeId: 'obj', toNodeId: 'lobj' }, { fromNodeId: 'i', toNodeId: 'li' }
    ], example.id);
    for (const field of ['PF_occurrences', 'LF_occurrences']) {
      const coverage = result.dispatch.evidenceCoverage.fields.find(entry => entry.key === field);
      assert.deepEqual(coverage.unrecoveredItemIndices, [2, 3]);
    }
    const fallback = result.items.find(item => item.kind === 'fallback');
    assert.deepEqual(fallback.relationRef.anchors, { PF_occurrences: ['v', 'tv'], LF_occurrences: ['lv', 'ltv'] });
    assert.deepEqual(fallback.relationRef.values, original.stage.relations[original.relationIndex].values);
    assert.deepEqual(example, original);
  }
});

test('partially recovered arrays keep each supported entry after neutral organization expires', () => {
  for (const example of correspondenceCases) {
    const stage = example.stage;
    const plan = compileRelationRenderPlan([stage, { ...stage, relations: [] }]);
    const owned = items => items.filter(item => item.relationRef.stageIndex === 0
      && item.relationRef.relationIndex === example.relationIndex);
    const moment = owned(visiblePlanFrameItems(plan, 0, new Set([example.relationIndex]), example.relationIndex));
    const rails = moment.filter(item => item.kind === 'anchor-set');
    assert.equal(rails.length, 1, 'all co-visible owners share one organizational set');
    assert(rails[0].set.roles.every(role => role.anchors.length === 5), 'the authored arrays remain complete at their moment');
    assert.equal(moment.filter(item => item.kind === 'undirected-link').length, 3);
    const nodeIds = stage.workspaceForest.flatMap(function walk(node) { return [node.id, ...(node.children ?? []).flatMap(walk)]; });
    const bind = items => bindRelationPlanFrame({ ...plan, frames: [{ stageIndex: 0, items }] }, 0,
      id => ({ x: nodeIds.indexOf(id) * 140, y: 0 }));
    const activeGeometry = bind(moment);
    assert.equal(activeGeometry.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 2);
    assert.equal(activeGeometry.primitives.filter(mark => mark.type === 'anchor-set-badge').length, 0,
      'existing exact neutral context numerals are reused at the moment, without duplicate badges');
    assert.deepEqual(activeGeometry.failed, []);
    for (const later of [owned(visiblePlanFrameItems(plan, 0, new Set([example.relationIndex]), null)),
      owned(visiblePlanFrameItems(plan, 1, new Set(), null))]) {
      const sets = later.filter(item => item.kind === 'anchor-set');
      assert.equal(sets.length, 1);
      assert(sets[0].set.roles.every(role => JSON.stringify(role.anchors.map(anchor => anchor.arrayIndex)) === '[0,1,4]'),
        'supported entries keep their original array ordinals, without promoting the ambiguous entries');
      assert.equal(later.filter(item => item.kind === 'undirected-link').length, 3);
      const geometry = bind(later);
      assert.equal(geometry.primitives.filter(mark => mark.type === 'anchor-set-rail').length, 2);
      assert.deepEqual(geometry.primitives.filter(mark => mark.type === 'anchor-set-badge').map(mark => mark.numeral), [1, 2, 5, 1, 2, 5]);
      assert(!geometry.primitives.some(mark => mark.type === 'fallback-mark'));
      assert.deepEqual(geometry.failed, []);
    }
  }
});

test('one vanished correspondence witness retires only its owning pair and array entries', () => {
  const example = correspondenceCases[0], next = structuredClone(example.stage);
  const remove = node => ({ ...node, children: (node.children ?? []).filter(child => child.id !== 'lsub').map(remove) });
  next.workspaceForest = next.workspaceForest.filter(node => node.id !== 'lsub').map(remove);
  next.relations = [];
  const plan = compileRelationRenderPlan([example.stage, next]);
  const items = visiblePlanFrameItems(plan, 1, new Set()).filter(item => item.relationRef.stageIndex === 0
    && item.relationRef.relationIndex === example.relationIndex);
  assert.deepEqual(items.filter(item => item.kind === 'undirected-link').flatMap(item => item.pairs), [
    { fromNodeId: 'obj', toNodeId: 'lobj' }, { fromNodeId: 'i', toNodeId: 'li' }
  ]);
  const set = items.find(item => item.kind === 'anchor-set');
  assert(set.set.roles.every(role => JSON.stringify(role.anchors.map(anchor => anchor.arrayIndex)) === '[1,4]'));
  assert(!set.set.roles.some(role => role.anchors.some(anchor => ['sub', 'lsub'].includes(anchor.nodeId))),
    'a surviving source cannot keep its organization when the complete owning pair disappears');
});

test('correspondence never chooses a member of a duplicate lineage family or pairs array positions', () => {
  const original = correspondenceCases[0];
  const reversed = structuredClone(original);
  reversed.stage.relations[reversed.relationIndex].anchors.LF_occurrences.reverse();
  assert.deepEqual(pairs(reversed), pairs(original));
  const nodes = root => [root, ...(root.children ?? []).flatMap(nodes)];
  for (const [changedId, lineage, expected] of [
    ['lsub', 'object', [{ fromNodeId: 'i', toNodeId: 'li' }]],
    ['sub', 'object', [{ fromNodeId: 'i', toNodeId: 'li' }]],
    ['i', 'unmatched', [{ fromNodeId: 'sub', toNodeId: 'lsub' }, { fromNodeId: 'obj', toNodeId: 'lobj' }]]
  ]) {
    const changed = structuredClone(original);
    changed.stage.workspaceForest.flatMap(nodes).find(node => node.id === changedId).lineageId = lineage;
    assert.deepEqual(pairs(changed), expected);
  }
  for (const mutate of [
    x => { x.stage.relations[x.relationIndex].anchors.PF_occurrences[1] = 'sub'; },
    x => { x.stage.relations[x.relationIndex].anchors.LF_occurrences[1] = 'missing'; },
    x => { x.stage.relations[x.relationIndex].anchors.interpretedOccurrences = ['lsub']; },
    x => { x.stage.workspaceForest.push(structuredClone(x.stage.workspaceForest[0])); }
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.deepEqual(pairs(changed), []);
  }
});

test('lineage cannot override denied or provisional correspondence while unrelated prose stays neutral', () => {
  const source = correspondenceCases[0];
  for (const status of ['failed', 'pending', 'denied', 'blocked', 'unknown', 'not established']) {
    const example = structuredClone(source);
    example.stage.relations[example.relationIndex].values.status = status;
    assert.deepEqual(pairs(example), [], status);
  }
  for (const relation of ['No cross-interface correspondence', 'Possible PF–LF correspondence',
    'Cross-interface correspondence not established', 'Denied cross-interface correspondence', 'Cross-interface correspondence is denied']) {
    const example = structuredClone(source);
    example.stage.relations[example.relationIndex].relation = relation;
    assert.deepEqual(pairs(example), [], relation);
  }
  const example = structuredClone(source), relation = example.stage.relations[example.relationIndex];
  relation.relation = 'Cross-interface correspondence; no movement';
  relation.values.explanation = 'A separate interpretation is unresolved; no extra movement is asserted.';
  relation.values.status = 'successful';
  assert.deepEqual(pairs(example), pairs(source));
  assert.deepEqual(inspect(example).dispatch.evidenceCoverage.fields.find(field => field.key === 'explanation').unrecoveredItemIndices, [0]);
});

test('recovering these claims leaves independent sibling drawings unchanged', () => {
  for (const example of saved) {
    const before = structuredClone(example.stage);
    before.relations[example.relationIndex] = { relation: 'Unspecified independent claim', anchors: {}, values: {} };
    const siblings = stage => compileRelationRenderPlan([stage]).frames[0].items
      .filter(item => item.relationRef.relationIndex !== example.relationIndex);
    assert.deepEqual(siblings(example.stage), siblings(before), example.id);
  }
});
