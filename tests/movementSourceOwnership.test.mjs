import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const records = JSON.parse(readFileSync(new URL('../fixtures/movement/source-occurrence-ownership.json', import.meta.url)));
const nodes = forest => forest.flatMap(node => [node, ...nodes(node.children ?? [])]);
const node = (forest, id) => nodes(forest).find(candidate => candidate.id === id);
const cases = [
  { id: 'sol-danish-active/0', stageIndex: 3, source: 'a1_i', target: 'a1_ic', witness: 'a1_i', kind: 'head', host: 'a1_cbar' },
  { id: 'astra-danish-impersonal/0', stageIndex: 2, source: 'subjectLow', target: 'subjectHigh', witness: 'subjectTrace', kind: 'phrasal' },
  { id: 'astra-danish-impersonal/2', stageIndex: 2, source: 'locLow', target: 'locHigh', witness: 'locTrace', kind: 'phrasal' }
];
const inputFor = c => structuredClone(records.find(record => record.id === c.id));
const recover = (record, c) => recoverMovementEvidence(record.derivationStages[c.stageIndex].relations[0],
  record.derivationStages[c.stageIndex].workspaceForest, record.derivationStages[c.stageIndex - 1].workspaceForest);

for (const c of cases) test(`${c.id}: movement owns its root occurrence and retains a separate authored witness`, () => {
  const record = inputFor(c), original = structuredClone(record);
  const movement = recover(record, c).movement;
  assert.ok(movement);
  assert.equal(movement.priorSourceNodeId, c.source);
  assert.equal(movement.sourceNodeId, c.source);
  assert.equal(movement.targetNodeId, c.target);
  assert.equal(movement.witnessNodeId, c.witness);
  assert.equal(movement.trajectoryKind, c.kind);
  assert.equal(movement.transition, true);
  const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
  const index = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === c.stageIndex
    && step.replayRelationIdentity.relationIndex === 0);
  assert.ok(index > 0);
  const before = steps[index - 1], moment = steps[index];
  const priorRoot = node(record.derivationStages[c.stageIndex - 1].workspaceForest, c.source);
  for (const member of nodes([priorRoot])) {
    assert.ok(before.replayVisibleNodeIds.includes(member.id), `preceding source member ${member.id}`);
    const shown = node([before.replayCanvasData], member.id);
    assert.equal(shown.word, member.word);
    assert.equal(shown.silent, member.silent);
  }
  const landing = node(record.derivationStages[c.stageIndex].workspaceForest, c.target);
  for (const member of nodes([landing])) {
    assert.ok(!before.replayVisibleNodeIds.includes(member.id), `landing waits: ${member.id}`);
    assert.ok(moment.replayVisibleNodeIds.includes(member.id), `complete landing: ${member.id}`);
  }
  assert.ok(moment.replayVisibleNodeIds.includes(c.witness));
  if (c.witness !== c.source) assert.ok(!before.replayVisibleNodeIds.includes(c.witness));
  if (c.host) {
    // The host head merges with its complement (its own step) before the head moves into it.
    assert.equal(before.replayKind, 'micro');
    assert.equal(before.operation, 'ExternalMerge');
    assert.equal(before.targetNodeId, c.host);
    assert.ok(!steps[index - 2].replayVisibleNodeIds.includes(c.host), 'the host appears at its own merge');
    assert.ok(moment.replayVisibleNodeIds.includes(c.host), 'the host stays as the head moves into it');
    assert.ok(!moment.replayVisibleNodeIds.includes('a1_npsc'), 'the independent later subject movement waits');
  }
  assert.equal(moment.replayRelationLinks.filter(link => link.authoredRelationKey === `${c.stageIndex}:0`
    && link.renderFamily === 'trajectory' && link.sourceNodeId === c.source && link.targetNodeId === c.target).length, 1);
  assert.deepEqual(record, original);
});

for (const c of cases) test(`${c.id}: source ownership is independent of names, spelling, field order, and pronunciation`, () => {
  const record = inputFor(c), id = value => `opaque-${value}`;
  for (const stage of record.derivationStages) {
    for (const n of nodes(stage.workspaceForest)) {
      n.id = id(n.id);
      if (n.lineageId) n.lineageId = id(n.lineageId);
      if (n.word) n.word = `word-${n.word.length}`;
    }
    for (const relation of stage.relations) {
      relation.relation = 'An authored dependency';
      for (const field of ['anchors', 'priorAnchors']) if (relation[field]) {
        relation[field] = Object.fromEntries(Object.entries(relation[field]).reverse()
          .map(([role, ids]) => [role, Array.isArray(ids) ? ids.map(id) : id(ids)]));
      }
    }
  }
  node(record.derivationStages[c.stageIndex].workspaceForest, id(c.source)).silent = false;
  const movement = recover(record, c).movement;
  assert.equal(movement?.priorSourceNodeId, id(c.source));
  assert.equal(movement?.sourceNodeId, id(c.source));
  assert.equal(movement?.targetNodeId, id(c.target));
  assert.equal(movement?.witnessNodeId, id(c.witness));
});

for (const c of cases.filter(c => c.source !== c.witness)) {
  test(`${c.id}: a lower root and its contained trace describe one movement witness`, () => {
    const record = inputFor(c), relation = record.derivationStages[c.stageIndex].relations[0];
    relation.anchors.lowerWitness = c.source;
    const original = structuredClone(record);
    const movement = recover(record, c).movement;
    assert.equal(movement?.sourceNodeId, c.source);
    assert.equal(movement?.targetNodeId, c.target);
    assert.equal(movement?.witnessNodeId, c.witness);
    const steps = prepareReplay({ ...record, includePlayback: true }).playbackSteps;
    const index = steps.findIndex(step => step.replayRelationIdentity?.stageIndex === c.stageIndex
      && step.replayRelationIdentity.relationIndex === 0);
    assert.ok(index > 0);
    assert.ok(!steps[index - 1].replayVisibleNodeIds.includes(c.target));
    assert.ok(steps[index].replayVisibleNodeIds.includes(c.target));
    assert.equal(steps[index].replayRelationLinks.filter(link => link.renderFamily === 'trajectory'
      && link.authoredRelationKey === `${c.stageIndex}:0`).length, 1);
    assert.deepEqual(record, original);
  });

  test(`${c.id}: distinct nested-witness branches and multi-occurrence fields remain unresolved`, () => {
    for (const listField of [false, true]) {
      const record = inputFor(c), stage = record.derivationStages[c.stageIndex];
      const source = node(stage.workspaceForest, c.source), relation = stage.relations[0];
      if (listField) relation.anchors.lowerWitness = [c.source, c.witness];
      else {
        source.children.push({ id: 'other-witness', label: 't', silent: true });
        relation.anchors.lowerWitness = c.source;
        relation.anchors.departureWitness = 'other-witness';
      }
      assert.equal(recover(record, c).movement, undefined);
    }
  });
}

test('a contained head that actually leaves its complex remains the moving unit', () => {
  const member = { id: 'member', label: 'V', lineageId: 'verb', word: 'word' };
  const host = { id: 'host', label: 'I', silent: true };
  const complex = { id: 'complex', label: 'I', lineageId: 'inflection', children: [member, host] };
  const prior = [{ id: 'root', label: 'IP', children: [complex] }];
  const current = [{ id: 'root', label: 'IP', children: [
    { ...complex, children: [{ id: 'trace', label: 'V', lineageId: 'verb', silent: true }, host] },
    { id: 'receiving', label: 'C', children: [
      { ...member, id: 'landing' }, { id: 'c', label: 'C', silent: true }
    ] }
  ] }];
  const relation = { relation: 'An authored dependency',
    anchors: { movedHead: 'landing', trace: 'trace', landingHead: 'receiving' },
    priorAnchors: { source: 'member', sourceComplex: 'complex' } };
  const movement = recoverMovementEvidence(relation, current, prior).movement;
  assert.equal(movement?.priorSourceNodeId, 'member');
  assert.equal(movement?.sourceNodeId, 'trace');
  assert.equal(movement?.targetNodeId, 'landing');
  assert.deepEqual(movement?.priorContextKeys, ['sourceComplex']);
});

for (const c of cases) test(`${c.id}: incomplete or competing root evidence remains unresolved`, () => {
  const mutations = {
    'missing root lineage': ({ source }) => { delete source.lineageId; },
    'different landing lineage': ({ target }) => { target.lineageId = 'unrelated'; },
    'duplicate lower occurrence': ({ stage, source }) => { stage.workspaceForest.push(structuredClone(source)); },
    'duplicate prior occurrence': ({ previous, before }) => { previous.workspaceForest.push(structuredClone(before)); },
    'lower occurrence in a different structural slot': ({ stage, source }) => {
      const parent = nodes(stage.workspaceForest).find(n => n.children?.includes(source));
      parent.children = parent.children.filter(n => n !== source);
      stage.workspaceForest.push(source);
    },
    'independent asserted current source': ({ stage, relation }) => {
      stage.workspaceForest.push({ id: 'other-source', label: 'XP', lineageId: 'other' });
      relation.anchors.source = 'other-source';
    },
    'independent asserted prior source': ({ previous, relation }) => {
      previous.workspaceForest.push({ id: 'other-prior-source', label: 'XP', lineageId: 'other' });
      relation.priorAnchors.source = 'other-prior-source';
    },
    'competing anchored landing': ({ stage, relation, target }) => {
      const other = { ...target, id: 'other-landing', children: undefined };
      stage.workspaceForest.push({ id: 'other-landing-parent', label: 'XP', children: [other] });
      relation.anchors.movedOccurrence = 'other-landing';
    },
    'witness outside its source root': ({ stage, relation }) => {
      stage.workspaceForest.push({ id: 'other-trace', label: 'trace', silent: true });
      for (const key of Object.keys(relation.anchors)) if (/trace/i.test(key) && !/lowerVerb/.test(key)) {
        relation.anchors[key] = 'other-trace';
      }
    }
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const record = inputFor(c), stage = record.derivationStages[c.stageIndex];
    const previous = record.derivationStages[c.stageIndex - 1];
    mutate({ stage, previous, relation: stage.relations[0], source: node(stage.workspaceForest, c.source),
      target: node(stage.workspaceForest, c.target), before: node(previous.workspaceForest, c.source) });
    assert.equal(recover(record, c).movement, undefined, name);
  }
});

test('whole-head ownership requires the named member at the same landing path and lineage', () => {
  const c = cases[0];
  for (const mutate of [
    landing => { landing.children.reverse(); },
    landing => { delete landing.children[0].lineageId; },
    landing => { landing.children[0].lineageId = 'unrelated'; },
    landing => { landing.children[0].label = 'VP'; }
  ]) {
    const record = inputFor(c);
    mutate(node(record.derivationStages[c.stageIndex].workspaceForest, c.target));
    assert.equal(recover(record, c).movement, undefined);
  }
});
