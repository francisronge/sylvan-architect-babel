import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkMovementEndpoints } from './helpers/replayContractWarnings.mjs';

// Subject raising whose claim names the landing's site beside the moved
// subject, as Opus wrote {mover, trace, landingSite} (opus-parts n3-76 5:0,
// where main drew opt1 -> cp1 although recognition proved opt1 -> op1).
const subject = (id, extra = {}) => ({ id, label: 'DP', lineageId: 'kim', word: 'Kim', ...extra });
const record = {
  sentence: 'Kim will sing',
  derivationStages: [
    { statement: 'test', stageRecord: 'test', relations: [], workspaceForest: [{ id: 'tbar', label: "T'", children: [
      { id: 't', label: 'T', word: 'will' }, { id: 'vp', label: 'VP', children: [subject('kimHigh'), { id: 'v', label: 'V', word: 'sing' }] }] }] },
    { statement: 'test', stageRecord: 'test', relations: [{ relation: 'A-movement', anchors: { mover: 'kimHigh', trace: 'kimTrace', landingSite: 'tp' } }],
      workspaceForest: [{ id: 'tp', label: 'TP', children: [subject('kimHigh'), { id: 'tbar', label: "T'", children: [{ id: 't', label: 'T', word: 'will' },
        { id: 'vp', label: 'VP', children: [subject('kimTrace', { word: undefined, silent: true }), { id: 'v', label: 'V', word: 'sing' }] }] }] }] }
  ]
};
const replay = prepareReplay({ ...structuredClone(record), includePlayback: true });
const redrawn = edit => {
  const plan = structuredClone(replay.relationRenderPlan);
  plan.frames[1].items.filter(item => item.kind === 'trajectory').forEach(edit);
  return { ...replay, relationRenderPlan: plan };
};

test('movement-endpoints control: a movement drawn between its proven endpoints is clean', () => {
  assert.ok(replay.relationRenderPlan.frames[1].items.some(item => item.kind === 'trajectory'
    && item.sourceNodeId === 'kimTrace' && item.targetNodeId === 'kimHigh'));
  assert.deepEqual(checkMovementEndpoints(replay, record), []);
});

test('movement-endpoints reports an arrow that ends at the landing\'s site instead of the landing', () => {
  const found = checkMovementEndpoints(redrawn(item => { item.targetNodeId = 'tp'; }), record);
  assert.deepEqual(found.map(({ rule, subtype, subject: key }) => [rule, subtype, key]),
    [['movement-unrendered', 'PATH_OFF_PROVEN_ENDPOINTS', '1:0']]);
  assert.match(found[0].detail, /draws kimTrace->tp while its movement proves kimTrace->kimHigh/);
  assert.equal(checkMovementEndpoints(redrawn(item => { item.sourceNodeId = 'v'; }), record).length, 1);
});

test('movement-endpoints accepts a hop drawn between occurrences of the proven chain', () => {
  // A successive hop may be drawn to the intermediate copy the phrase later
  // leaves; it shares the landing's lineage.
  const withCopy = structuredClone(record);
  withCopy.derivationStages[1].workspaceForest[0].children[1].children.push(subject('kimEdge', { word: undefined, silent: true }));
  const prepared = prepareReplay({ ...structuredClone(withCopy), includePlayback: true });
  const plan = structuredClone(prepared.relationRenderPlan);
  plan.frames[1].items.filter(item => item.kind === 'trajectory').forEach(item => { item.targetNodeId = 'kimEdge'; });
  assert.deepEqual(checkMovementEndpoints({ ...prepared, relationRenderPlan: plan }, withCopy), []);
});
