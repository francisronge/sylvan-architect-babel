import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan, visiblePlanFrameItems } from '../replay/relations/renderPlanCompiler.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { formatAuthoredWitnessSurface, formatTraceSurfaceForDisplayValue } from '../replay/replaySurfaceNotation.ts';

const examples = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/diverse-recovery.json', import.meta.url))).examples;
const walk = node => [node, ...(node.children ?? []).flatMap(walk)];
const expand = example => {
  const bank = new Map();
  const node = n => {
    if (n.refId) return structuredClone(bank.get(n.refId));
    const out = { ...n, children: (n.children ?? []).map(node) };
    bank.set(n.id, out);
    return out;
  };
  return example.analysis.derivationStages.map(s => ({ ...structuredClone(s), workspaceForest: s.workspaceForest.map(node) }));
};
const saved = id => expand(examples.find(e => e.id === id));
const inspect = (stage, relation) => {
  const dispatch = dispatchRelationClaims({ relation, currentForest: stage.workspaceForest,
    currentRealizations: stage.realizations, stageIndex: 0, relationIndex: 0 });
  const items = compileRelationRenderPlan([{ ...stage, relations: [relation] }]).frames[0].items;
  return { dispatch, items, families: dispatch.claims.filter(c => c.tier === 2).map(c => c.facet.recipe.id) };
};
const pfCases = examples.flatMap(example => expand(example).flatMap(stage => stage.relations
  .filter(r => Object.keys(r.values ?? {}).some(k => ['output', 'form', 'inputWord', 'inputSpelling'].includes(k))
    && /realization|contraction/u.test(r.relation))
  .map(relation => ({ id: example.id, stage, relation }))));

test('saved joint spellings belong to every authored contributor, including an anchored containing domain', () => {
  assert.equal(pfCases.length, 13);
  for (const { id, stage, relation } of pfCases) {
    const original = structuredClone(stage);
    const plates = inspect(stage, relation).items.filter(i => i.kind === 'node-plaque' && i.plaqueStyle === 'realization');
    assert.equal(plates.length, 1, `${id}: ${relation.relation}`);
    assert.deepEqual(new Set(plates[0].anchorNodeIds), new Set(Object.values(relation.anchors).flat()));
    assert(!inspect(stage, relation).items.some(i => ['trajectory', 'rewrite-arrow'].includes(i.kind)));
    assert.deepEqual(stage, original);
    const plan = compileRelationRenderPlan([{ ...stage, relations: [relation] }, { ...stage, relations: [] }]);
    assert(visiblePlanFrameItems(plan, 1, new Set()).some(i => i.kind === 'node-plaque'
      && i.plaqueStyle === 'realization'), 'Tier 2 persists beyond its moment');
  }
});

test('joint spelling recovery refuses incomplete, ambiguous and denied groups', () => {
  for (const source of pfCases) {
    const key = Object.keys(source.relation.values).find(k => ['output', 'form', 'inputWord', 'inputSpelling'].includes(k));
    for (const mutate of [
      (s, r) => { delete s.realizations; },
      (s, r) => { s.realizations.push(...structuredClone(s.realizations)); },
      (s, r) => { r.anchors[Object.keys(r.anchors).at(-1)] = 'missing'; },
      (s, r) => { r.values[key] = ''; },
      (s, r) => { r.values.surfaceForm = 'competing spelling'; },
      (s, r) => { r.relation = `Possible ${r.relation}`; },
      (s, r) => { r.values.status = 'denied'; }
    ]) {
      const s = structuredClone(source.stage), r = structuredClone(source.relation); mutate(s, r);
      const collective = inspect(s, r).items.filter(i => i.kind === 'node-plaque'
        && i.plaqueStyle === 'realization' && i.anchorNodeIds.length > 1);
      assert.equal(collective.length, 0, `${source.id}: ${mutate}`);
    }
  }
});

test('explicit agreement probes control collection; a separate expression target remains context', () => {
  const stage = saved('sol-hindi-ergative-perfect')[2];
  for (const [index, probe] of [[0, 'perfect'], [1, 'pastAuxiliary']]) {
    const relation = stage.relations[index], result = inspect(stage, relation);
    assert(result.families.includes('feature.dependency'));
    const paths = result.items.filter(i => i.kind === 'directed-path');
    assert(paths.length);
    assert(paths.every(p => p.fromNodeId === probe && p.toNodeId === 'objectD'));
    if (index === 0) assert.deepEqual(result.dispatch.evidenceCoverage.fields.find(f => f.key === 'target').unrecoveredItemIndices, [0]);
    for (const mutate of [
      r => { r.anchors.controller = 'missing'; },
      r => { r.anchors.probe = ['perfect', 'pastAuxiliary']; },
      r => { r.values = {}; }
    ]) {
      const changed = structuredClone(relation); mutate(changed);
      assert(!inspect(stage, changed).families.includes('feature.dependency'), String(mutate));
    }
    const noController = structuredClone(relation); delete noController.anchors.controller;
    assert(!inspect(stage, noController).items.some(i => i.kind === 'directed-path' && i.toNodeId === 'objectD'));
  }
});

test('causee Case requires a separate giver and literal, not the role name alone', () => {
  const stage = saved('sol-french-causative')[2], relation = stage.relations[3];
  const paths = inspect(stage, relation).items.filter(i => i.kind === 'directed-path');
  assert.deepEqual(paths.map(p => [p.fromNodeId, p.toNodeId]), [['cP', 'cChildrenNP']]);
  for (const key of ['caseLicensor', 'causee']) {
    const changed = structuredClone(relation); delete changed.anchors[key];
    assert(!inspect(stage, changed).families.includes('feature.dependency'));
  }
  assert(!inspect(stage, { ...relation, values: {} }).families.includes('feature.dependency'));
});

test('focus association uses explicit operators and restrictions without interpreting lexical words', () => {
  for (const [id, index, relationIndex, target] of [
    ['astra-hungarian-focus-particle', 2, 2, 'nameDP'],
    ['sol-hungarian-focus-particle', 3, 1, 'subjectFocus']
  ]) {
    const stage = saved(id)[index], relation = stage.relations[relationIndex];
    const links = inspect(stage, relation).items.filter(i => i.kind === 'undirected-link');
    assert.equal(links.length, 1);
    assert(links[0].pairs.some(pair => pair.toNodeId === target || pair.fromNodeId === target));
    for (const mutate of [
      r => { r.relation = 'Unspecified scope'; },
      r => { r.relation = `Possible ${r.relation}`; },
      r => { r.anchors.operator = ['only0', 'missing']; },
      r => { r.anchors.focusAssociate = 'missing'; },
      r => { r.values.status = 'denied'; }
    ]) {
      const changed = structuredClone(relation); mutate(changed);
      assert(!inspect(stage, changed).families.includes('focus.association'), `${id}: ${mutate}`);
    }
  }
});

test('nested phrasal landings attach atomically without an extra authored stage or reordered relations', () => {
  const example = examples.find(e => e.id === 'astra-hungarian-focus-particle');
  for (const rename of [false, true]) {
    const original = structuredClone(example);
    const stages = expand(example);
    const id = name => rename ? `renamed:${name}` : name;
    if (rename) {
      for (const stage of stages) {
        stage.workspaceForest.flatMap(walk).forEach(n => { n.id = id(n.id); });
        for (const r of stage.relations) for (const field of ['anchors', 'priorAnchors']) {
          for (const k of Object.keys(r[field] ?? {})) r[field][k] = Array.isArray(r[field][k]) ? r[field][k].map(id) : id(r[field][k]);
        }
      }
    }
    const { playbackSteps: steps } = prepareReplay({ ...example, derivationStages: stages, includePlayback: true });
    const moves = steps.filter(s => ['object topicalization', 'subject focus movement'].includes(s.operation));
    assert.deepEqual(moves.map(s => s.operation), ['object topicalization', 'subject focus movement']);
    assert(!steps.some(s => s.movementDiagnostics?.some(d => d.includes('TIMING_CONFLICT'))));
    for (const step of moves) {
      const visible = new Set(step.replayVisibleNodeIds), top = walk(step.replayCanvasData).find(n => n.id === id('topPhrase'));
      const connected = n => visible.has(n.id) ? [n.id, ...(n.children ?? []).flatMap(connected)] : [];
      for (const name of ['objectTopic', 'topBar', 'focusPhrase', 'focusBar', 'ip']) assert(connected(top).includes(id(name)), name);
    }
    assert(!moves[0].replayVisibleNodeIds.includes(id('subjectFocus')));
    assert(moves[0].replayVisibleNodeIds.includes(id('subject0')));
    assert(moves[1].replayVisibleNodeIds.includes(id('subjectFocus')));
    assert.deepEqual(example, original);
  }
});

test('trace typography preserves authored category and index notation exactly', () => {
  for (const notation of ['t', 't_V', 't_DP', 't_T', 'tᵥ', 't_i', 't₁', 'DP trace', '∅', 'silent word', '']) {
    assert.equal(formatTraceSurfaceForDisplayValue(notation, '9'), notation);
    assert.equal(formatAuthoredWitnessSurface(notation, '9', '2'), notation);
  }
});
