import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { frameStructure } from './helpers/replayInvariants.mjs';

const catalog = JSON.parse(readFileSync(new URL('../fixtures/replay-regressions/visual-human-catalog.json', import.meta.url), 'utf8'));
const momentOf = (steps, stageIndex, relationIndex) => steps.findIndex(step => step.replayKind === 'relation'
  && step.replayRelationIdentity?.stageIndex === stageIndex && step.replayRelationIdentity.relationIndex === relationIndex);
const sameSyntax = (left, right) => frameStructure(left).key === frameStructure(right).key;

test('a claim naming an earlier and a wrapped later proposition leaves the adjunction to an External Merge step', () => {
  const entry = catalog.cases[6];
  const record = { sentence: entry.sentence, inputTokens: entry.inputTokens, derivationStages: entry.analyses[0].derivationStages };
  const steps = prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
  const at = momentOf(steps, 2, 2), merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'timedMatrixTP');
  assert.ok(merge >= 0 && merge < at, 'the new TP has its own construction step before the particle scope moment');
  assert.equal(steps[merge].operation, 'ExternalMerge');
  const built = frameStructure(steps[merge]);
  assert.deepEqual(['yesterday', 'matrixTP'].map(id => built.parent.get(id)), ['timedMatrixTP', 'timedMatrixTP']);
  assert.equal(steps[at].replayTreeTransition, undefined, 'the relation owns no transition');
  assert.ok(sameSyntax(steps[at - 1], steps[at]), 'the relation moment changes no syntax');
});

const leaf = (id, word) => ({ id, label: 'X', word, children: [] });
const branch = (id, ...children) => ({ id, label: 'XP', children });
const scopeRecord = (current) => ({ sentence: 'p q now', derivationStages: [
  { statement: 'Before', stageRecord: 'The proposition is built.', relations: [], workspaceForest: [branch('root', branch('prop', leaf('p', 'p')), leaf('q', 'q')), leaf('adv', 'now')] },
  { statement: 'After', stageRecord: 'The proposition is restated.', workspaceForest: current,
    relations: [{ relation: 'proposition scope', anchors: { proposition: 'wrapped' }, priorAnchors: { earlierProposition: 'prop' } }] }] });

test('a new parent in the witness\'s own slot is construction; a witness taken elsewhere stays the relation\'s rewrite', () => {
  const inPlace = prepareReplay({ ...scopeRecord([branch('root', branch('wrapped', leaf('adv', 'now'), branch('prop', leaf('p', 'p'))), leaf('q', 'q'))]),
    includePlayback: true }).playbackSteps;
  const at = momentOf(inPlace, 1, 0);
  assert.ok(inPlace.slice(0, at).some(step => step.replayKind === 'micro' && step.operation === 'ExternalMerge' && step.targetNodeId === 'wrapped'));
  assert.equal(inPlace[at].replayTreeTransition, undefined);
  assert.ok(sameSyntax(inPlace[at - 1], inPlace[at]));
  const displaced = prepareReplay({ ...scopeRecord([branch('root', leaf('q', 'q'), branch('wrapped', leaf('adv', 'now'), branch('prop', leaf('p', 'p'))))]),
    includePlayback: true }).playbackSteps;
  const moment = displaced[momentOf(displaced, 1, 0)];
  assert.ok(moment.replayTreeTransition?.currentNodeIds.includes('wrapped'), 'a displaced witness keeps the atomic rewrite');
  assert.ok(!displaced.some(step => step.replayKind === 'micro' && step.targetNodeId === 'wrapped'));
});
