import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, children, ...extra });
const stage = (workspaceForest, relations = []) => ({ workspaceForest, relations, statement: 'State', stageRecord: 'Authored state.' });
const example = () => {
  const base = node('base', 'V', [], { word: 'read', lineageId: 'verb' });
  const object = node('object', 'DP', [], { word: 'books' });
  const host = node('host', 'T', [], { silent: true });
  const prior = [node('vp', 'VP', [object, base]), host];
  const current = [node('tp', 'TP', [node('vp', 'VP', [object, { ...base, id: 'trace', word: undefined, silent: true }]),
    node('complex', 'T', [{ ...base, id: 'raised' }, host])])];
  const relation = { relation: 'V-to-T head movement', anchors: { raisedHead: 'raised', resultingHead: 'complex', target: 'host', trace: 'trace' }, priorAnchors: { source: 'base', target: 'host' } };
  return { prior, current, relation };
};
const play = ({ prior, current }, relations) => buildReplayPlayback({ sentence: 'read books', analyses: [{ tree: current[0], derivationStages: [stage(prior), stage(current, relations)] }] }).steps;

test('a host, resulting complex and moved occurrence bind to distinct structural roles', () => {
  const x = example();
  for (const priorKey of ['source', 'sourceHead', 'previousOccurrence']) {
    const relation = { ...x.relation, priorAnchors: { [priorKey]: 'base', target: 'host' } };
    const result = recoverMovementEvidence(relation, x.current, x.prior);
    assert.equal(result.movement?.targetNodeId, 'raised');
    assert.equal(result.movement?.sourceNodeId, 'trace');
    assert.equal(result.movement?.trajectoryKind, 'head');
    assert.equal(result.diagnostics.length, 0);
  }
  const bad = structuredClone(x);
  bad.relation.anchors.target = 'object';
  assert.equal(recoverMovementEvidence(bad.relation, bad.current, bad.prior).movement, undefined);
});

test('recognizing gap notation cannot remove its participant from a neutral structural update', () => {
  const x = example();
  for (const root of [...x.prior, ...x.current]) {
    const clear = n => { delete n.lineageId; n.children.forEach(clear); }; clear(root);
  }
  const steps = play(x, [x.relation]);
  const moment = steps.find(s => s.replayKind === 'relation' && s.replayFrameIndex === 1);
  assert(moment.replayVisibleNodeIds.includes('trace'));
  assert(moment.replayVisibleNodeIds.includes('raised'));
  assert(!moment.replayVisibleNodeIds.includes('base'));
});

test('a later chain restatement does not steal the lower witness from movement', () => {
  const x = example();
  const restatement = { relation: 'Chain preservation', anchors: { lowerCopy: 'trace', higherCopy: 'raised' }, priorAnchors: { source: 'base' } };
  const steps = play(x, [x.relation, restatement]);
  const moments = steps.filter(s => s.replayKind === 'relation' && s.replayFrameIndex === 1);
  assert.equal(moments.length, 2);
  for (const moment of moments) {
    assert(moment.replayVisibleNodeIds.includes('trace'));
    assert(moment.replayVisibleNodeIds.includes('raised'));
    assert(!moment.movementDiagnostics?.some(d => d.includes('TIMING_CONFLICT')));
  }
});

test('a complex moves as one occurrence while its new host is available to an earlier claim', () => {
  const x = example();
  const base = x.prior[0].children[1];
  Object.assign(base, { label: 'v', word: undefined, children: [
    node('verb', 'V', [], { word: 'read', lineageId: 'lexical' }), node('light', 'v', [], { silent: true })
  ] });
  const lower = { ...structuredClone(base), id: 'trace', silent: true };
  const upper = { ...structuredClone(base), id: 'raised' };
  upper.children[0].id = 'upperVerb'; upper.children[1].id = 'upperLight';
  x.current[0].children[0].children[1] = lower;
  x.current[0].children[1].children[0] = upper;
  x.prior.pop(); // T is new this stage; only the moved complex existed earlier.
  const movement = { relation: 'A new compound description', anchors: {
    higherComplex: 'raised', lowerComplex: 'trace', host: 'host', resultingHead: 'complex', pronouncedVerb: 'upperVerb'
  }, priorAnchors: { sourceComplex: 'base', previouslyPronouncedVerb: 'verb' } };
  const agreement = { relation: 'Agreement', anchors: { probe: 'host', goal: 'object' }, values: { agreement: 'plural' } };
  const original = structuredClone(x);
  assert.equal(recoverMovementEvidence(movement, x.current, x.prior).movement?.targetNodeId, 'raised');
  const steps = play(x, [agreement, movement]);
  const before = steps.find(s => s.replayKind === 'relation' && s.operation === 'Agreement');
  const after = steps.find(s => s.replayKind === 'relation' && s.operation === movement.relation);
  assert(before.replayVisibleNodeIds.includes('host'));
  assert(before.replayVisibleNodeIds.includes('base'));
  assert(!before.replayVisibleNodeIds.includes('raised'));
  for (const id of ['raised', 'trace', 'complex', 'tp']) assert(after.replayVisibleNodeIds.includes(id), id);
  assert(!steps.some(s => s.movementDiagnostics?.some(d => d.includes('TIMING_CONFLICT'))));
  assert.deepEqual(x, original);
});
