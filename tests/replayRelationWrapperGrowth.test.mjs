import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { prepareReplay } from '../replay/prepareReplay.ts';
import { checkNoEarlyReveal, frameStructure } from './helpers/replayInvariants.mjs';

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

test('the subject movement brings T′ at its own moment, so the matrix TP stays binary', () => {
  const entry = catalog.cases[6];
  const steps = prepareReplay({ sentence: entry.sentence, inputTokens: entry.inputTokens,
    derivationStages: structuredClone(entry.analyses[0].derivationStages), includePlayback: true }).playbackSteps;
  const moment = momentOf(steps, 2, 0), scope = momentOf(steps, 2, 2);
  assert.equal(steps[moment].operation, 'Matrix subject movement and licensing');
  assert.deepEqual(frameStructure(steps[moment - 1]).children.get('matrixTP'), ['matrixT', 'matrixVP']);
  const raised = steps.flatMap((step, index) => frameStructure(step).displayed.has('subjectHigher') ? [index] : []);
  assert.equal(raised[0], moment, 'the raised subject first appears at its movement');
  for (const index of raised) {
    const frame = frameStructure(steps[index]);
    assert.deepEqual([frame.children.get('matrixTP'), frame.children.get('matrixTProjection')],
      [['subjectHigher', 'matrixTProjection'], ['matrixT', 'matrixVP']], `frame ${index + 1}`);
  }
  // 昨天 adjoins with its own External Merge after the movement and before the scope claim.
  const merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'timedMatrixTP');
  assert.ok(moment < merge && merge < scope && steps[merge].operation === 'ExternalMerge');
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
/** The same stages with the witness, and then its wrapper, in one slot of an
 * earlier parent. The witness leaves that parent for the wrapper, so the
 * stage displaces it and only the wrapper release can make the wrapper construction. */
const underEarlierParent = record => {
  const nest = (forest, id) => forest.map(root => root.id === id ? branch('top', root, leaf('zt', 'zt')) : root);
  const [before, after] = record.derivationStages;
  return { ...record, derivationStages: [{ ...before, workspaceForest: nest(before.workspaceForest, 'prop') },
    { ...after, workspaceForest: nest(after.workspaceForest, 'wrapped') }] };
};

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
      [{ ...branch('wrapped', leaf('adv', 'now'), proposition(leaf('p', 'p', { lineageId: 'P' }))), lineageId: 'P' }], [scope])
  })) {
    // A root witness merged unchanged is displaced by nothing, so construction builds the new material and the wrapper.
    assert.ok(releasedToConstruction(play(record)), `${name} at the root`);
    assert.ok(keepsRewrite(play(underEarlierParent(record))), `${name} under an earlier parent`);
  }
  assert.ok(keepsRewrite(play(stagePair([branch('top', proposition(), leaf('z', 'z')), leaf('adv', 'now')],
    [branch('top', leaf('z', 'z'), branch('wrapped', leaf('adv', 'now'), proposition()))], [scope]))), 'another parent order');
  assert.ok(releasedToConstruction(play(stagePair([branch('top', proposition(), leaf('z', 'z')), leaf('adv', 'now')],
    [branch('top', branch('wrapped', leaf('adv', 'now'), proposition()), leaf('z', 'z'))], [scope]))), 'in place under an earlier parent');
});

// The rewrite applies a later VocabularyInsertion's word at the restating
// claim's moment, as main does without any wrapper; this rule leaves that timing alone.
test('another claim that can own a change in the wrapped material, before or after the restating claim, keeps the rewrite', () => {
  const insertion = { relation: 'VocabularyInsertion', anchors: { terminal: 'p' }, values: { input: 'p', output: 'changed' } };
  const wrappedNow = (p = leaf('p', 'p'), q = leaf('q', 'q')) => [branch('wrapped', leaf('adv', 'now'), proposition(p, q))];
  const earlier = [proposition(), leaf('adv', 'now')];
  const sameWord = stagePair(earlier, wrappedNow(), [scope, { ...insertion, values: { input: 'p', output: 'p' } }]);
  // At the root nothing the claims cover changes, so the merge is construction.
  assert.ok(releasedToConstruction(play(sameWord)), 'a later insertion of the same word at the root');
  for (const [name, record] of Object.entries({
    'a later insertion of a changed word': stagePair(earlier, wrappedNow(leaf('p', 'changed')), [scope, insertion]),
    'a later insertion of the same word under an earlier parent': underEarlierParent(sameWord),
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

test('the claim\'s other anchors must be earlier material unchanged in place, or the claim keeps the rewrite', () => {
  const scopeWith = anchors => ({ ...scope, anchors: { ...scope.anchors, ...anchors } });
  const earlier = [proposition(), leaf('adv', 'now'), leaf('z', 'z', { lineageId: 'Z' })];
  const wrapped = (...rest) => [branch('wrapped', leaf('adv', 'now'), proposition()), ...rest];
  for (const [name, record, other] of [
    ['a changed word', stagePair(earlier, wrapped(leaf('z', 'Z!', { lineageId: 'Z' })), [scopeWith({ other: 'z' })]), 'z'],
    ['a new silence', stagePair(earlier, wrapped(leaf('z', 'z', { lineageId: 'Z', silent: true })), [scopeWith({ other: 'z' })]), 'z'],
    ['a new root under an earlier parent', underEarlierParent(stagePair(earlier.slice(0, 2), wrapped(leaf('zNew', 'new')),
      [scopeWith({ other: 'zNew' })])), 'zNew'],
    ['a new copy of an earlier object', stagePair(earlier, wrapped(branch('zr', leaf('zc', 'z', { lineageId: 'Z' }),
      leaf('z', undefined, { lineageId: 'Z', silent: true }))), [scopeWith({ other: 'zc' })]), 'zc']
  ]) {
    const steps = play(record);
    assert.ok(keepsRewrite(steps, ['wrapped', other]), name);
    assert.deepEqual(checkNoEarlyReveal(prepareReplay({ ...structuredClone(record), includePlayback: true })), [], name);
  }
  const prior = steps => steps[scopeMoment(steps) - 1];
  const changed = play(stagePair(earlier, wrapped(leaf('z', 'Z!', { lineageId: 'Z' })), [scopeWith({ other: 'z' })]));
  assert.equal(wordOf(prior(changed), 'z'), 'z', 'the earlier word stays until the moment');
  assert.ok(releasedToConstruction(play(stagePair(earlier, wrapped(leaf('z', 'z', { lineageId: 'Z' })), [scopeWith({ other: 'z' })]))),
    'an unchanged anchor is context the claim observes');
  const newRoot = play(stagePair(earlier.slice(0, 2), wrapped(leaf('zNew', 'new')), [scopeWith({ other: 'zNew' })]));
  assert.ok(releasedToConstruction(newRoot) && builtByConstruction(newRoot, ['zNew']).length === 1,
    'with nothing displaced, a new root the claim names is selected by construction');
});

test('material a movement leaves outside both its occurrences is not the movement\'s, so a change there keeps the rewrite', () => {
  // The subject raises without its PP, which extraposes into the VP and changes its word.
  const node = (id, label, children = [], fields = {}) => ({ id, label, children, ...fields });
  const word = (id, label, text, fields = {}) => node(id, label, [], { word: text, ...fields });
  const subject = pp => node('subj', 'D', [word('D', 'D', 'the'), node('N', 'N', [word('kids', 'N', 'kids'), ...pp])], { lineageId: 'S' });
  const record = { sentence: 'the kids yesterday left', derivationStages: [
    { statement: 'Before', stageRecord: 'Built.', relations: [], workspaceForest: [
      node('TP', 'T', [node('T', 'T', [], { silent: true }), node('VP', 'V', [word('V', 'V', 'left'), subject([node('PPx', 'P', [word('px', 'P', 'here')])])])]),
      word('adv', 'Adv', 'yesterday')] },
    { statement: 'After', stageRecord: 'Wrapped.', relations: [
      { relation: 'Subject movement and licensing', anchors: { higherOccurrence: 'subjHigh', licensingHead: 'T', lowerOccurrence: 'subj' },
        priorAnchors: { sourceOccurrence: 'subj' } },
      { relation: 'proposition scope', anchors: { proposition: 'wrapped' }, priorAnchors: { earlierProposition: 'TP' } }],
    workspaceForest: [node('wrapped', 'T', [word('adv', 'Adv', 'yesterday'), node('TP', 'T', [
      node('subjHigh', 'D', [word('D', 'D', 'the'), node('N', 'N', [word('kids', 'N', 'kids')])], { lineageId: 'S' }),
      node('Tbar', 'T', [node('T', 'T', [], { silent: true }), node('VP', 'V', [word('V', 'V', 'left'),
        node('subj', 'D', [], { lineageId: 'S', silent: true }), node('PPx', 'P', [word('px', 'P', 'THERE')])])])])])] }] };
  const steps = play(record), at = momentOf(steps, 1, 1);
  assert.ok(ownsRewrite(steps[at], ['wrapped', 'PPx', 'px']));
  assert.deepEqual(builtByConstruction(steps, ['wrapped']), []);
  assert.equal(wordOf(steps[at - 1], 'px'), 'here', 'the earlier word stays until the scope moment');
  assert.equal(wordOf(steps[at], 'px'), 'THERE');
});

test('a movement inside the witness leaves the wrapper to construction whether its lower occurrence keeps the source id or not', () => {
  const node = (id, label, children = [], fields = {}) => ({ id, label, children, ...fields });
  const word = (id, label, text) => node(id, label, [], { word: text });
  const subject = id => node(id, 'D', [word('D', 'D', 'the'), word('N', 'N', 'kids')], { lineageId: 'S' });
  const silentT = () => node('T', 'T', [], { silent: true });
  for (const lower of ['subj', 'subjLow']) {
    const record = { sentence: 'the kids yesterday left', derivationStages: [
      { statement: 'Before', stageRecord: 'Built.', relations: [], workspaceForest: [
        node('TP', 'T', [silentT(), node('VP', 'V', [word('V', 'V', 'left'), subject('subj')])]), word('adv', 'Adv', 'yesterday')] },
      { statement: 'After', stageRecord: 'Wrapped.', relations: [
        { relation: 'Subject movement and licensing', anchors: { higherOccurrence: 'subjHigh', lowerOccurrence: lower },
          priorAnchors: { sourceOccurrence: 'subj' } },
        { relation: 'proposition scope', anchors: { proposition: 'wrapped' }, priorAnchors: { earlierProposition: 'TP' } }],
      workspaceForest: [node('wrapped', 'T', [word('adv', 'Adv', 'yesterday'), node('TP', 'T', [subject('subjHigh'),
        node('Tbar', 'T', [silentT(), node('VP', 'V', [word('V', 'V', 'left'), node(lower, 'D', [], { lineageId: 'S', silent: true })])])])])] }] };
    const steps = play(record), at = momentOf(steps, 1, 1), merge = steps.findIndex(step => step.replayKind === 'micro' && step.targetNodeId === 'wrapped');
    assert.ok(momentOf(steps, 1, 0) < merge && merge < at && steps[at].replayTreeTransition === undefined, lower);
    assert.deepEqual(checkNoEarlyReveal(prepareReplay({ ...structuredClone(record), includePlayback: true })), [], lower);
  }
});
