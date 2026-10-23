import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { loadFixtureAnalyses } from './helpers/replayInvariantCorpus.mjs';
import { frameStructure } from './helpers/replayInvariants.mjs';

// A head moves into a host head that is already merged with its complement, and before any
// phrasal landing above that host: External Merge of C with IP (C′), then I-to-C, then the
// subject's movement, whose landing creates CP. No moment shows another movement's landing.
const corpus = loadFixtureAnalyses();
const record = id => structuredClone(corpus.records.find(entry => entry.id === id).record);
const reorder = (authored, stage, order) => {
  const relations = authored.derivationStages[stage].relations;
  authored.derivationStages[stage].relations = order.map(index => relations[index]);
  return authored;
};
const steps = authored => prepareReplay({ ...authored, includePlayback: true }).playbackSteps;
const stageOrder = (all, stage) => all.filter(step => step.replayFrameIndex === stage)
  .map(step => step.replayKind === 'relation' ? `relation ${step.replayRelationIdentity.relationIndex}` : `${step.operation} ${step.targetNodeId}`);
/** Every pronounced input word painted at most once in a frame. */
const pronouncedTwice = all => all.flatMap((step, index) => {
  const structure = frameStructure(step), seen = new Map(), out = [];
  for (const id of structure.displayed) {
    const node = structure.nodes.get(id).data;
    let silent = false;
    for (let at = id; at; at = structure.parent.get(at)) silent ||= structure.nodes.get(at).data.silent === true;
    if (silent || node.children?.length || !Number.isInteger(node.tokenIndex)) continue;
    if (seen.has(node.tokenIndex)) out.push(`frame ${index + 1}: token ${node.tokenIndex} painted at ${seen.get(node.tokenIndex)} and ${id}`);
    else seen.set(node.tokenIndex, id);
  }
  return out;
});

test('Estonian V2: C merges with IP before I moves into C, and the subject then creates CP', () => {
  const all = steps(record('replay-regressions/native-plaque-footprints.json#'));
  const order = stageOrder(all, 4);
  const merge = order.indexOf('ExternalMerge cBar'), head = order.indexOf('relation 1'), subject = order.indexOf('relation 2');
  assert.ok(merge >= 0 && merge < head && head < subject, order.join(', '));
  const moment = all.find(step => step.replayFrameIndex === 4 && step.replayRelationIdentity?.relationIndex === 1);
  const structure = frameStructure(moment);
  assert.equal(structure.parent.get('cRaised'), 'cBar', 'the head complex is inside C′ at its own moment');
  assert.ok(!structure.displayed.has('cp'), 'CP waits for the subject movement');
});

test('Danish V2 with relations authored V2, subject, I-to-C: I-to-C plays before the subject lands, and no word is painted twice', () => {
  const all = steps(reorder(record('movement/source-occurrence-ownership.json#/0'), 3, [2, 1, 0]));
  const order = stageOrder(all, 3);
  // Relations after reordering: 0 V2 configuration, 1 subject A-bar movement, 2 I-to-C.
  assert.ok(order.indexOf('ExternalMerge a1_cbar') < order.indexOf('relation 2'), order.join(', '));
  assert.ok(order.indexOf('relation 2') < order.indexOf('relation 1'), order.join(', '));
  const subject = all.find(step => step.replayFrameIndex === 3 && step.replayRelationIdentity?.relationIndex === 1);
  const before = all[all.indexOf(all.find(step => step.replayFrameIndex === 3 && step.replayRelationIdentity?.relationIndex === 2)) - 1];
  assert.ok(!frameStructure(before).displayed.has('a1_c'), 'the C head complex appears only at I-to-C');
  assert.ok(frameStructure(subject).displayed.has('a1_c'));
  assert.deepEqual(pronouncedTwice(all), []);
});

test('a head moving into a host the preceding stage already merged reports no timing conflict', () => {
  // Spanish V-to-I with a clitic complex above the landing: I stood in I′ before, so V-to-I needs no new host merge.
  for (const id of ['replay-regressions/head-movement-ordinary-wrapper.json#', 'replay-regressions/ordinary-receiving-width-control.json#']) {
    const conflicts = steps(record(id)).flatMap(step => step.movementDiagnostics ?? []).filter(message => message.includes('RELATION_TIMING_CONFLICT'));
    assert.deepEqual(conflicts, [], id);
  }
});
