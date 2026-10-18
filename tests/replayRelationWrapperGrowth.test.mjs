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

const leaf = (id, word, fields = {}) => ({ id, label: 'X', word, children: [], ...fields });
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

const play = record => prepareReplay({ ...structuredClone(record), includePlayback: true }).playbackSteps;
const builtByConstruction = (steps, ids) => ids.filter(id => steps.some(step => step.replayKind === 'micro' && step.targetNodeId === id));
const shown = (step, id) => frameStructure(step).displayed.has(id);
const wordOf = (step, id) => frameStructure(step).nodes.get(`${id}::__leaf`)?.data.word;
const wrapRecord = (p, current, anchors) => ({ sentence: 'p q now', derivationStages: [
  { statement: 'Before', stageRecord: 'The proposition is built.', relations: [], workspaceForest: [branch('prop', p, leaf('q', 'q')), leaf('adv', 'now')] },
  { statement: 'After', stageRecord: 'The proposition is wrapped.', workspaceForest: current,
    relations: [{ relation: 'proposition scope', anchors, priorAnchors: { earlierProposition: 'prop' } }] }] });
const ownsRewrite = (moment, ids) => ids.every(id => moment.replayTreeTransition?.currentNodeIds.includes(id));

test('a wrapped witness whose interior only this claim changes keeps the relation\'s atomic rewrite', () => {
  const steps = play(wrapRecord(leaf('p', 'p'), [branch('wrapped', leaf('adv', 'now'), branch('prop', leaf('p', 'changed'), leaf('q', 'q')))],
    { proposition: 'wrapped' }));
  const at = momentOf(steps, 1, 0);
  assert.ok(ownsRewrite(steps[at], ['wrapped', 'prop', 'p']));
  assert.deepEqual(builtByConstruction(steps, ['wrapped']), []);
  assert.equal(wordOf(steps[at - 1], 'p'), 'p', 'the earlier word stays until the relation moment');
  assert.equal(wordOf(steps[at], 'p'), 'changed');
});

test('new material inside a wrapped witness that no other claim owns keeps the relation\'s atomic rewrite', () => {
  const output = play(wrapRecord(leaf('p', 'p'), [branch('wrapped', leaf('adv', 'now'), branch('prop', branch('output', leaf('p', 'p')), leaf('q', 'q')))],
    { proposition: 'wrapped', output: 'output' }));
  assert.ok(ownsRewrite(output[momentOf(output, 1, 0)], ['wrapped', 'output']), 'an anchored new node inside the witness is the claim\'s output');
  assert.deepEqual(builtByConstruction(output, ['wrapped', 'output']), []);
  // A new occurrence of an earlier object inside the witness, anchored or not.
  const copied = [branch('wrapped', leaf('adv', 'now'), branch('prop', leaf('high', 'p', { lineageId: 'P' }),
    branch('rest', leaf('q', 'q'), leaf('p', undefined, { lineageId: 'P', silent: true }))))];
  for (const anchors of [{ proposition: 'wrapped', copy: 'high' }, { proposition: 'wrapped' }]) {
    const steps = play(wrapRecord(leaf('p', 'p', { lineageId: 'P' }), copied, anchors));
    const at = momentOf(steps, 1, 0);
    assert.ok(ownsRewrite(steps[at], ['wrapped', 'high', 'p']), JSON.stringify(anchors));
    assert.deepEqual(builtByConstruction(steps, ['wrapped', 'rest', 'high']), []);
    assert.ok(!shown(steps[at - 1], 'high') && wordOf(steps[at - 1], 'p') === 'p', 'the copy and the lower silence wait for the moment');
  }
});

test('without frame 49\'s subject movement claim, the change inside matrixTP keeps the scope claim\'s atomic rewrite', () => {
  const entry = catalog.cases[6];
  const stages = structuredClone(entry.analyses[0].derivationStages);
  stages[2].relations.splice(0, 1);
  const steps = play({ sentence: entry.sentence, inputTokens: entry.inputTokens, derivationStages: stages });
  const at = momentOf(steps, 2, 1);
  assert.equal(steps[at].operation, 'Change-of-state particle scope');
  assert.ok(ownsRewrite(steps[at], ['timedMatrixTP', 'subjectHigher', 'matrixTProjection']), 'with no movement claim, the scope claim owns the rewrite');
  assert.deepEqual(builtByConstruction(steps, ['timedMatrixTP']), []);
});
