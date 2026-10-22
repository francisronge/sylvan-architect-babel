import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { readCategoryLabel } from '../replay/categoryLabel.ts';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/unrendered-head-movement.json', import.meta.url), 'utf8'));

const movementMoments = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps
  .filter(step => step.replayKind === 'relation' && /head movement/u.test(step.operation))
  .map(step => {
    const key = `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`;
    return {
      key,
      arrows: (step.replayRelationLinks ?? []).filter(link => link.authoredRelationKey === key && link.renderFamily === 'trajectory')
        .map(link => `${link.trajectoryKind}:${link.sourceNodeId}->${link.targetNodeId}`),
      diagnostics: (step.movementDiagnostics ?? []).map(diagnostic => diagnostic.split(':')[0])
    };
  });
const find = (nodes, id) => nodes.map(node => node.id === id ? node : find(node.children ?? [], id)).find(Boolean);

test('head movement between prose-labelled heads draws a head arrow when the relation names its host', () => {
  assert.equal(readCategoryLabel('Honorific head: complex'), undefined, 'the labels spell no category notation');
  assert.deepEqual(movementMoments(fixture), [
    { key: '2:0', arrows: ['head:verbTrace->verbAtHonorific'], diagnostics: [] },
    // The moved complexes keep their phrasal reading: these two stages cannot
    // show that earlier head movement, rather than phrasal movement, built them.
    { key: '3:0', arrows: ['phrasal:honorificTrace->honorificAtInflection'], diagnostics: ['MOVEMENT_CONTEXT_UNPROVEN'] },
    { key: '4:0', arrows: ['phrasal:inflectionTrace->inflectionAtComplementizer'], diagnostics: ['MOVEMENT_CONTEXT_UNPROVEN'] }
  ]);
});

test('the prose-label structural reading needs an unchanged host in its slot and an explicitly named host', () => {
  const changed = structuredClone(fixture);
  const complex = find(changed.derivationStages[2].workspaceForest, 'honorificComplex');
  complex.children[1] = { ...complex.children[1], word: '시' };
  assert.deepEqual(movementMoments(changed)[0].arrows, [], 'a changed host proves no adjunction');
  const unnamed = structuredClone(fixture);
  delete unnamed.derivationStages[2].relations[0].anchors['host head'];
  assert.deepEqual(movementMoments(unnamed)[0], { key: '2:0', arrows: [], diagnostics: ['MOVEMENT_CONTEXT_UNRESOLVED'] },
    'the shape alone does not distinguish a phrase beside a bare head');
});

test('each member of a compound head may carry its own features', () => {
  assert.deepEqual(readCategoryLabel('Asp⁰[progressive]+Pred+v+V'),
    { category: 'Asp', head: 'Asp', kind: 'head', compound: true, members: ['Asp', 'Pred', 'v', 'V'] });
  assert.equal(readCategoryLabel('Asp⁰[progressive'), undefined, 'malformed notation stays uninterpreted');
});

const leaf = (id, label, extra = {}) => ({ id, label, ...extra });
const node = (id, label, children, extra = {}) => ({ id, label, children, ...extra });
const recover = ({ relation, current, prior }) => {
  const result = recoverMovementEvidence(relation, current, prior);
  return result.movement ? `${result.movement.trajectoryKind}:${result.movement.sourceNodeId}->${result.movement.targetNodeId}` : result.failure;
};
const unproven = ({ relation, current, prior }) => recoverMovementEvidence(relation, current, prior).diagnostics
  .filter(diagnostic => diagnostic.startsWith('MOVEMENT_CONTEXT_UNPROVEN'));

// A bare D merges beside an unchanged terminal T, in T's preceding slot, under
// a new prose-labelled parent.
const besideBareHead = ({ right = false, parentLabel = 'T-projection', landingLabel = 'D',
  host = leaf('t', 'T', { word: 'will' }), anchors = {} } = {}) => {
  const landing = leaf('dHigh', landingLabel, { word: 'she', lineageId: 'dChain' });
  const verb = leaf('v', 'V', { word: 'leave' });
  return {
    prior: [node('tp', 'TP', [host, node('vp', 'VP', [leaf('d', landingLabel, { word: 'she', lineageId: 'dChain' }), verb])])],
    current: [node('tp', 'TP', [node('tProj', parentLabel, right ? [host, landing] : [landing, host]),
      node('vp', 'VP', [leaf('dLow', landingLabel, { silent: true, lineageId: 'dChain' }), verb])])],
    relation: { relation: 'Subject movement to the specifier', anchors: { 'raised subject': 'dHigh', 'subject trace': 'dLow', ...anchors },
      priorAnchors: { 'movement source': 'd' } }
  };
};

test('a phrase beside a bare terminal head is not head adjunction without further head evidence', () => {
  for (const right of [false, true]) {
    assert.equal(recover(besideBareHead({ right })), 'MOVEMENT_CONTEXT_UNRESOLVED', `right=${right}`);
    assert.equal(recover(besideBareHead({ right, anchors: { 'landing site': 'tProj' } })), 'MOVEMENT_CONTEXT_UNRESOLVED');
    assert.equal(recover(besideBareHead({ right, anchors: { 'attracting head': 't' } })), 'MOVEMENT_CONTEXT_UNRESOLVED',
      'a phrasal attractor names no adjunction host');
  }
  const named = { 'host head': 't' };
  assert.equal(recover(besideBareHead({ host: node('t', 'T', [leaf('tSubject', 'DP', { word: 'it' }), leaf('tWord', 'T', { word: 'will' })]),
    anchors: named })), 'MOVEMENT_CONTEXT_UNRESOLVED', 'a host with syntactic children is not a bare head');
  assert.equal(recover(besideBareHead({ parentLabel: 'C', anchors: named })), 'MOVEMENT_CONTEXT_UNRESOLVED',
    'when every label reads as notation, the notation decides');
  assert.equal(recover(besideBareHead({ parentLabel: 'C: clitic cluster', anchors: named })), 'MOVEMENT_CONTEXT_UNRESOLVED',
    'an explicit host head of another category does not project the complex');
  for (const right of [false, true]) assert.equal(recover(besideBareHead({ right, anchors: named })), 'head:dLow->dHigh',
    'an explicitly named host proves the adjunction');
});

test('the field that authorizes the structural reading is checked in its own role', () => {
  for (const anchors of [{ 'host head': 'tProj' }, { 'head complex': 't' }]) {
    assert.equal(recover(besideBareHead({ anchors })), 'MOVEMENT_CONTEXT_UNRESOLVED',
      `${Object.keys(anchors)[0]} names the wrong node, so it proves no adjunction`);
  }
  for (const anchors of [{ 'host head': 't' }, { 'head complex': 'tProj' }, { host: 't' }, { host: 'tProj' }]) {
    const input = besideBareHead({ anchors });
    assert.equal(recover(input), 'head:dLow->dHigh', JSON.stringify(anchors));
    assert.deepEqual(unproven(input), [], 'an authorizing field is never itself reported unproven');
  }
});

// [A N] whose modifier copy left its trace beside it: that earlier movement
// was phrasal, so moving the whole expression beside a head stays phrasal.
const copiedModifierNominal = (nominal, anchors = { 'host head': 'v' }) => {
  const modifier = id => leaf(id, 'A', { word: 'big', lineageId: 'aChain' });
  const trace = leaf('aLow', 'A', { silent: true, lineageId: 'aChain' });
  return {
    prior: [node('vp', 'VP', [leaf('v', 'V', { word: 'saw' }), node('obj', 'Nominal phrase', [
      node('np', nominal, [modifier('aHigh'), leaf('n', 'N', { word: 'dog' })], { lineageId: 'npChain' }), trace])])],
    current: [node('vp', 'VP', [
      node('vComplex', 'Verb complex', [node('npHigh', nominal, [modifier('aHigher'), leaf('nHigh', 'N', { word: 'dog' })],
        { lineageId: 'npChain' }), leaf('v', 'V', { word: 'saw' })]),
      node('obj', 'Nominal phrase', [leaf('npLow', nominal, { silent: true, lineageId: 'npChain' }), trace])])],
    relation: { relation: 'Nominal movement', anchors: { 'moved nominal': 'npHigh', trace: 'npLow', ...anchors },
      priorAnchors: { 'movement source': 'np' } }
  };
};

test('a moved branching expression stays phrasal when nothing shows earlier head assembly', () => {
  for (const nominal of ['N', 'Nominal expression']) {
    assert.equal(recover(copiedModifierNominal(nominal)), 'phrasal:npLow->npHigh', nominal);
    assert.equal(recover(copiedModifierNominal(nominal, {})), 'phrasal:npLow->npHigh', nominal);
  }
});
