import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { canonicalId } from './helpers/canonicalIds.mjs';

const records = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/qualified-contexts.json', import.meta.url)));
const flatten = forest => forest.flatMap(node => [node, ...flatten(node.children ?? [])]);
const find = (forest, id) => flatten(forest).find(node => node.id === id);
const recover = r => recoverMovementEvidence(r.relation, r.currentForest, r.priorForest);
const stage = (workspaceForest, relations = []) => ({ statement: '', stageRecord: '', workspaceForest, relations });
const prepare = r => prepareReplay({ sentence: '', includePlayback: true,
  derivationStages: [stage(r.priorForest), stage(r.currentForest, [r.relation])] });

test('bundled categories retain head notation without treating phrases or prose as heads', () => {
  for (const label of ['T/Aux[past,finite]', 'I/Infl⁰', 'V⁰/T⁰', 'T+Aux']) {
    assert.equal(readCategoryLabel(label)?.kind, 'head', label);
    assert.equal(readCategoryLabel(label)?.compound, true, label);
  }
  for (const label of ['T/TP', 'NP/N', 'T/V′', 'T/', '/T', 'T//Aux', 'T/finite auxiliary'])
    assert.equal(readCategoryLabel(label), undefined, label);
});

for (const record of records) {
  test(`${record.name}: exact source, landing and path appear atomically with authored labels intact`, () => {
    const r = structuredClone(record), original = structuredClone(r), movement = recover(r).movement;
    assert.deepEqual([movement?.sourceNodeId, movement?.targetNodeId, movement?.trajectoryKind],
      [r.sourceNodeId, r.targetNodeId, r.trajectoryKind]);
    const prepared = prepare(r), steps = prepared.playbackSteps;
    const moment = steps.findIndex(s => s.replayRelationIdentity?.stageIndex === 1);
    assert(moment > 0);
    // The authored source and landing, as Replay names them in the stage it reads.
    const [source, target] = [r.sourceNodeId, r.targetNodeId].map(id => canonicalId(prepared, id, 1));
    const landing = flatten([find(prepared.derivationStages[1].workspaceForest, target)]).map(node => node.id);
    const precedingIds = new Set(flatten(r.priorForest).map(node => node.id));
    for (const id of landing) {
      assert(steps[moment].replayVisibleNodeIds.includes(id), `landing member ${id}`);
      if (!precedingIds.has(id)) assert(steps.slice(0, moment).every(s => !s.replayVisibleNodeIds.includes(id)), `early ${id}`);
    }
    assert(steps[moment].replayVisibleNodeIds.includes(source));
    assert(steps[moment].replayRelationLinks.some(link => link.renderFamily === 'trajectory'
      && link.sourceNodeId === source && link.targetNodeId === target));
    assert.equal(prepared.relationRenderPlan.frames[1].items.filter(item => item.kind === 'trajectory').length, 1);
    assert.deepEqual(r, original);
  });

  for (const [name, mutate] of [
    ['wrong landing lineage', r => { find(r.currentForest, r.targetNodeId).lineageId = 'different'; }],
    ['missing prior source', r => { r.priorForest = []; }],
    ['duplicate landing ID', r => { r.currentForest.push(structuredClone(find(r.currentForest, r.targetNodeId))); }],
    ['competing explicit landing', r => {
      r.currentForest.push({ ...structuredClone(find(r.currentForest, r.targetNodeId)), id: 'competing' });
      r.relation.anchors.higherOccurrence = 'competing';
    }]
  ]) test(`${record.name} refuses ${name}`, () => {
    const r = structuredClone(record); mutate(r);
    assert.equal(recover(r).movement, undefined);
    assert(!prepare(r).relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'));
  });
}

test('unchanged descriptive head contents do not license a changed host or phrasal contents', () => {
  const record = records.find(r => r.name === 'preserved-head-contents');
  for (const mutate of [
    r => { find(r.currentForest, 'rI').children.reverse(); },
    r => { find(r.currentForest, 'rNom').word = '-different'; },
    r => { find(r.priorForest, 'rNom').label = find(r.currentForest, 'rNom').label = 'IP'; },
    r => { find(r.priorForest, 'rI').label = 'IP'; }
  ]) {
    const r = structuredClone(record); mutate(r);
    assert.notEqual(recover(r).movement?.trajectoryKind, 'head');
  }
});

test('generic head is context only when the exact retained head projects beside the phrasal landing', () => {
  const record = records.find(r => r.name === 'contextual-head');
  assert.equal(recover(record).movement?.targetNodeId, 'aDPHigh');
  for (const mutate of [
    r => { r.relation.anchors.head = 'aDP'; },
    r => { find(r.currentForest, 'aT').label = 'TP'; },
    r => { find(r.currentForest, 'aT').word = 'different'; },
    r => { r.currentForest.push(structuredClone(find(r.currentForest, 'aT'))); }
  ]) {
    const r = structuredClone(record); mutate(r);
    assert.equal(recover(r).movement, undefined);
  }
});

test('a generic head inside a complex spelled by its members still projects beside the phrasal landing', () => {
  for (const label of ['T', 'Asp+T', 'T+Asp']) {
    const r = structuredClone(records.find(r => r.name === 'contextual-head'));
    const core = find(r.currentForest, 'aTCore');
    core.children[0] = { id: 'aTComplex', label, children: [{ id: 'aAsp', label: 'Asp', silent: true }, core.children[0]] };
    assert.equal(recover(r).movement?.targetNodeId, 'aDPHigh', label);
  }
});

test('a containing landing clause proves its topic shell without replacing the moved nominal endpoint', () => {
  const r = records.find(r => r.name === 'containing-landing-clause'), movement = recover(r).movement;
  assert(movement.context.some(c => c.key === 'landingClause' && c.nodeId === 'cp-sentence' && c.kind === 'site'));
  const dispatch = dispatchRelationClaims({ ...r, stageIndex: 1, relationIndex: 0 });
  assert.deepEqual(dispatch.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === 'landingClause').unrecoveredItemIndices, []);
  const outer = structuredClone(r);
  outer.currentForest = [{ id: 'outer', label: 'CP', children: outer.currentForest }];
  outer.relation.anchors.landingClause = 'outer';
  assert.equal(recover(outer).movement, undefined, 'an arbitrary containing ancestor cannot redirect the target');
  const explicit = structuredClone(r);
  explicit.relation.anchors.higherOccurrence = explicit.relation.anchors.landingClause;
  assert.equal(recover(explicit).movement, undefined, 'a contradictory occurrence role is not downgraded to context');
});
