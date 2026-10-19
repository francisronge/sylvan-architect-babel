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

const nodeOf = (step, id) => frameStructure(step).nodes.get(id)?.data;
const scope = { relation: 'proposition scope', anchors: { proposition: 'wrapped' }, priorAnchors: { earlierProposition: 'prop' } };
const stagePair = (prior, current, relations) => ({ sentence: 'p q now', derivationStages: [
  { statement: 'Before', stageRecord: 'The proposition is built.', relations: [], workspaceForest: prior },
  { statement: 'After', stageRecord: 'The proposition is wrapped.', workspaceForest: current, relations }] });
const proposition = (p = leaf('p', 'p'), q = leaf('q', 'q')) => branch('prop', p, q);
const scopeMoment = steps => steps.findIndex(step => step.replayKind === 'relation' && step.replayRelationIdentity?.stageIndex === 1
  && step.operation === 'proposition scope');
const releasedToConstruction = (steps) => {
  const at = scopeMoment(steps), merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'wrapped');
  return merge >= 0 && merge < at && steps[merge].operation === 'ExternalMerge' && steps[at].replayTreeTransition === undefined
    && sameSyntax(steps[at - 1], steps[at]);
};
const keepsRewrite = (steps, ids = ['wrapped', 'prop']) => builtByConstruction(steps, ['wrapped']).length === 0
  && ownsRewrite(steps[scopeMoment(steps)], ids);

test('an earlier workspace that joins the wrapper changed, so the relation keeps the rewrite and the change waits for its moment', () => {
  const variants = {
    word: [leaf('adv', 'now'), leaf('adv', 'NOW')],
    silence: [leaf('adv', 'now'), leaf('adv', 'now', { silent: true })],
    order: [branch('adv', leaf('a1', 'a'), leaf('a2', 'b')), branch('adv', leaf('a2', 'b'), leaf('a1', 'a'))]
  };
  for (const [name, [before, after]] of Object.entries(variants)) {
    const steps = play(stagePair([proposition(), before], [branch('wrapped', after, proposition())], [scope]));
    assert.ok(keepsRewrite(steps, ['wrapped', 'adv', 'prop']), name);
    const prior = steps[scopeMoment(steps) - 1];
    if (name === 'order') assert.deepEqual(frameStructure(prior).children.get('adv'), ['a1', 'a2'], 'the earlier order stays until the moment');
    else assert.deepEqual([wordOf(prior, 'adv'), nodeOf(prior, 'adv').silent], ['now', undefined], `the earlier ${name} stays until the moment`);
  }
});

test('a root witness keeps its slot under the wrapper whatever the order of the other workspaces', () => {
  for (const [prior, current] of [
    [[leaf('adv', 'now'), proposition()], [branch('wrapped', leaf('adv', 'now'), proposition())]],
    [[proposition(), leaf('adv', 'now'), leaf('extra', 'x')], [leaf('extra', 'x'), branch('wrapped', leaf('adv', 'now'), proposition())]],
    [[proposition(), leaf('adv', 'now'), leaf('extra', 'x')], [branch('wrapped', leaf('adv', 'now'), proposition()), leaf('extra', 'x')]],
    [[leaf('extra', 'x'), proposition(), leaf('adv', 'now')], [leaf('extra', 'x'), branch('wrapped', leaf('adv', 'now'), proposition())]]
  ]) assert.ok(releasedToConstruction(play(stagePair(prior, current, [scope]))), JSON.stringify(current.map(root => root.id)));
});

test('only the wrapper may be new around the witness, which it wraps directly in its own slot', () => {
  const earlier = [proposition(), leaf('adv', 'now')];
  for (const [name, record] of Object.entries({
    'a new sister': stagePair([proposition()], [branch('wrapped', leaf('adv', 'now'), proposition())], [scope]),
    'a new parent between': stagePair(earlier, [branch('wrapped', leaf('adv', 'now'), branch('mid', proposition()))], [scope]),
    'an earlier lineage': stagePair([proposition(leaf('p', 'p', { lineageId: 'P' })), leaf('adv', 'now')],
      [{ ...branch('wrapped', leaf('adv', 'now'), proposition(leaf('p', 'p', { lineageId: 'P' }))), lineageId: 'P' }], [scope]),
    'another parent order': stagePair([branch('top', proposition(), leaf('z', 'z')), leaf('adv', 'now')],
      [branch('top', leaf('z', 'z'), branch('wrapped', leaf('adv', 'now'), proposition()))], [scope])
  })) assert.ok(keepsRewrite(play(record)), name);
  assert.ok(releasedToConstruction(play(stagePair([branch('top', proposition(), leaf('z', 'z')), leaf('adv', 'now')],
    [branch('top', branch('wrapped', leaf('adv', 'now'), proposition()), leaf('z', 'z'))], [scope]))), 'in place under an earlier parent');
});

// The rewrite applies a later VocabularyInsertion's word at the restating
// claim's moment, as main does without any wrapper; this rule leaves that timing alone.
test('another claim that can own a change in the wrapped material, before or after the restating claim, keeps the rewrite', () => {
  const insertion = { relation: 'VocabularyInsertion', anchors: { terminal: 'p' }, values: { input: 'p', output: 'changed' } };
  const wrappedNow = (p = leaf('p', 'p'), q = leaf('q', 'q')) => [branch('wrapped', leaf('adv', 'now'), proposition(p, q))];
  const earlier = [proposition(), leaf('adv', 'now')];
  for (const [name, record] of Object.entries({
    'a later insertion of a changed word': stagePair(earlier, wrappedNow(leaf('p', 'changed')), [scope, insertion]),
    'a later insertion of the same word': stagePair(earlier, wrappedNow(), [scope, { ...insertion, values: { input: 'p', output: 'p' } }]),
    'an earlier rewrite of a word': stagePair(earlier, wrappedNow(undefined, leaf('q', 'Q')),
      [{ relation: 'q update', anchors: { updated: 'q' }, priorAnchors: { updated: 'q' } }, scope]),
    'a rewrite of an ancestor': stagePair([branch('top', proposition(), leaf('z', 'z')), leaf('adv', 'now')],
      [branch('top', ...wrappedNow(), leaf('z', 'z'))], [scope, { relation: 'top restated', anchors: { clause: 'top' }, priorAnchors: { clause: 'top' } }])
  })) assert.ok(keepsRewrite(play(record)), name);
  // An observation that owns no change may name the wrapper, the witness and what joins them.
  const observed = play(stagePair(earlier, wrappedNow(),
    [{ relation: 'modification', anchors: { modifier: 'adv', clause: 'prop', whole: 'wrapped', word: 'p' } }, scope]));
  assert.ok(releasedToConstruction(observed));
  assert.deepEqual(play(stagePair(earlier, wrappedNow(), [scope])), play(stagePair(earlier, wrappedNow(), [scope])), 'preparation is repeatable');
});
