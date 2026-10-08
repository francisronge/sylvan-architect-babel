import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';

const { fixtures } = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/clitic-displacement.json', import.meta.url)));
const walk = forest => forest.flatMap(n => [n, ...walk(n.children ?? [])]);
const parent = (forest, id) => walk(forest).find(n => n.children?.some(c => c.id === id));
const expand = analysis => {
  const bank = new Map();
  const node = n => {
    if (n.refId) return structuredClone(bank.get(n.refId));
    const value = { ...n, children: (n.children ?? []).map(node) };
    bank.set(n.id, value);
    return value;
  };
  return analysis.derivationStages.map(s => ({ ...s, workspaceForest: s.workspaceForest.map(node) }));
};
const input = fixture => {
  const stages = expand(structuredClone(fixture.analysis));
  return { stages, before: stages.at(-2).workspaceForest, after: stages.at(-1).workspaceForest,
    relation: stages.at(-1).relations[0] };
};
const recover = value => recoverMovementEvidence(value.relation, value.after, value.before);

for (const fixture of fixtures) {
  test(`${fixture.model}: displacement owns its first relation moment and its complete landing`, () => {
    const original = structuredClone(fixture), value = input(fixture);
    const movement = recover(value).movement;
    const carrier = fixture.model === 'astra' ? 'object' : 'objectD';
    assert.deepEqual([movement?.priorSourceNodeId, movement?.sourceNodeId, movement?.targetNodeId],
      [carrier, 'objectTrace', carrier]);
    assert.equal(movement.trajectoryKind, fixture.model === 'astra' ? 'phrasal' : 'head');
    const replay = prepareReplay({ ...fixture, derivationStages: fixture.analysis.derivationStages, includePlayback: true });
    const stageIndex = value.stages.length - 1;
    const n = replay.playbackSteps.findIndex(s => s.replayRelationIdentity?.stageIndex === stageIndex
      && s.replayRelationIdentity.relationIndex === 0);
    assert(n > 0);
    const before = replay.playbackSteps[n - 1], moment = replay.playbackSteps[n];
    assert.equal(parent([before.replayCanvasData], carrier)?.id, parent(value.before, carrier)?.id);
    assert(!before.replayVisibleNodeIds.includes('objectTrace'));
    const host = parent(value.after, carrier).id;
    assert.equal(parent([moment.replayCanvasData], carrier)?.id, host);
    assert(moment.replayVisibleNodeIds.includes(host));
    assert(moment.replayVisibleNodeIds.includes('objectTrace'));
    assert(moment.replayRelationLinks.some(l => l.authoredRelationKey === `${stageIndex}:0`
      && l.sourceNodeId === 'objectTrace' && l.targetNodeId === carrier));
    assert.deepEqual(fixture, original);
  });

  test(`${fixture.model}: relation names, lexical spelling and IDs cannot supply movement proof`, () => {
    const value = input(fixture);
    const remap = new Map([...walk(value.before), ...walk(value.after)].map(n => [n.id, `renamed-${n.id}`]));
    for (const n of [...walk(value.before), ...walk(value.after)]) {
      n.id = remap.get(n.id);
      if (n.word) n.word = 'unrelated';
    }
    for (const field of ['anchors', 'priorAnchors']) for (const [key, ids] of Object.entries(value.relation[field] ?? {})) {
      value.relation[field][key] = Array.isArray(ids) ? ids.map(id => remap.get(id)) : remap.get(ids);
    }
    value.relation.relation = 'An authored dependency';
    value.relation.values = {};
    assert.equal(recover(value).movement?.targetNodeId, remap.get(fixture.model === 'astra' ? 'object' : 'objectD'));
  });

  test(`${fixture.model}: directional role names cannot repair missing or conflicting structural evidence`, () => {
    for (const mutate of [
      v => { v.before = []; },
      v => { delete walk(v.after).find(n => n.id === 'objectTrace').lineageId; },
      v => { walk(v.after).find(n => n.id === 'objectTrace').lineageId = 'unrelated'; },
      v => { parent(v.after, 'objectTrace').children.unshift({ id: 'extra', label: 'N', children: [] }); },
      v => { delete v.relation.anchors.sourceTrace; },
      v => { v.relation.anchors.sourceTrace = ['objectTrace', 'objectTrace']; },
      v => { v.relation.priorAnchors.sourceClitic = fixture.model === 'astra' ? 'read' : 'readV'; }
    ]) {
      const value = input(fixture); mutate(value);
      assert.equal(recover(value).movement, undefined, String(mutate));
    }
  });
}

test('a containing source phrase remains context, never the moving unit or a consumed claim', () => {
  const value = input(fixtures.find(f => f.model === 'sol'));
  const result = dispatchRelationClaims({ relation: value.relation, currentForest: value.after, priorForest: value.before,
    stageIndex: value.stages.length - 1, relationIndex: 0 });
  assert(result.facets.some(f => f.recipe.id === 'movement.path'));
  const field = result.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === 'sourceDP');
  assert(!field.recognizedBy.some(c => c.claim === 'movement.path'));
  value.relation.anchors.sourceDP = 'subjectDP';
  assert.equal(recover(value).movement, undefined, 'an unrelated competing source must not be discarded');
});
