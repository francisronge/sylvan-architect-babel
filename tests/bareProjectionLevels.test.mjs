/* Bare Phrase Structure labels (T for TP, T′ and T) leave projection levels
 * to structure. Each consumer that once read the level from the label must
 * read the same structure the same way in either notation. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inferHeadLikeTrajectoryKindFromForest } from '../replay/movementLinks.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { readStructuralProjections } from '../replay/projectionStructure.ts';
import { normalizeReplaySentenceInitialCasing } from '../replay/replayCasing.ts';
import { describeReplayNodePosition } from '../replay/replayNodeDescription.ts';
import { toBareForest } from './helpers/bareLabels.mjs';

const node = (id, label, children = [], extra = {}) => ({ id, label, ...(children.length ? { children } : {}), ...extra });
const word = (id, label, text, extra = {}) => ({ id, label, word: text, ...extra });
const find = (forest, id) => forest.map(root => root.id === id ? root : find(root.children ?? [], id)).find(Boolean);

// Who did Mia see? as X-bar writes it: wh-phrase in Spec,CP, T-to-C head
// movement and a subject in Spec,TP.
const question = () => [node('cp', 'CP', [
  node('whHigh', 'DP', [word('what', 'D', 'What', { lineageId: 'whatHead' }), node('np', 'NP', [word('thing', 'N', 'thing')])], { lineageId: 'wh' }),
  node('cbar', 'C′', [
    node('c', 'C⁰', [word('didHigh', 'T⁰', 'did', { lineageId: 'did' }), node('q', 'C⁰')]),
    node('tp', 'TP', [word('mia', 'DP', 'Mia'), node('tbar', 'T′', [
      word('didLow', 'T⁰', 'did', { lineageId: 'did', silent: true }),
      node('vp', 'VP', [node('vbar', 'V′', [word('see', 'V⁰', 'see'),
        node('whLow', 'DP', [word('whatLow', 'D', 'what', { lineageId: 'whatHead', silent: true }),
          node('npLow', 'NP', [word('thingLow', 'N', 'thing', { silent: true })])], { lineageId: 'wh', silent: true })])])])])])])];

test('bare labels read levels from structure; X-bar labels keep their notation', () => {
  assert.equal(readStructuralProjections(question()), undefined);
  assert.equal(readStructuralProjections([node('tp', 'T-projection', [node('t', 'T')])]), undefined, 'prose names a level too');
  const forest = toBareForest(question()), bare = readStructuralProjections(forest), at = id => find(forest, id);
  const level = id => `${bare.minimal(at(id)) ? 'min' : ''}${bare.maximal(at(id)) ? 'max' : ''}` || 'bar';
  assert.deepEqual(['cp', 'cbar', 'c', 'didHigh', 'q', 'tp', 'tbar', 'didLow', 'mia', 'whHigh', 'what'].map(level),
    ['max', 'bar', 'min', 'minmax', 'min', 'max', 'bar', 'min', 'minmax', 'max', 'min']);
  assert.equal(bare.positionKind(at('didHigh')), 'head', 'T adjoined inside the complex C');
  assert.equal(bare.positionKind(at('whHigh')), 'phrasal');
  assert.equal(bare.positionKind(at('mia')), 'phrasal', 'a one-word specifier');
});

test('a head pair is complex only when structure shows head movement', () => {
  const clitics = toBareForest([node('tp', 'TP', [node('cluster', 'T⁰', [word('gli', 'D', 'gli', { lineageId: 'gli' }),
    node('inner', 'T⁰', [word('lo', 'D', 'lo', { lineageId: 'lo' }), node('t', 'T⁰')])]),
  node('vp', 'VP', [word('verb', 'V', 'dare'), node('objects', 'VP', [word('gliLow', 'D', 'gli', { lineageId: 'gli' }),
    word('loLow', 'D', 'lo', { lineageId: 'lo' })])])])]);
  const cliticReader = readStructuralProjections(clitics);
  assert(cliticReader.minimal(find(clitics, 'inner')) && cliticReader.minimal(find(clitics, 'cluster')),
    'each clitic has its lower occurrence in the domain its cluster c-commands');
  // Object shift: the copy beside VP is a phrase moved out, not a head.
  const shifted = toBareForest([node('vp', 'VP', [word('object', 'DP', 'it', { lineageId: 'it' }),
    node('lower', 'VP', [word('eat', 'V', 'eat'), word('objectLow', 'DP', 'it', { lineageId: 'it', silent: true })])])]);
  const shiftedReader = readStructuralProjections(shifted);
  assert(!shiftedReader.minimal(find(shifted, 'lower')));
  assert.equal(shiftedReader.positionKind(find(shifted, 'object')), 'phrasal');
});

test('panel positions use the X-bar names with the authored bare label', () => {
  const xbar = question()[0], bare = toBareForest(question())[0];
  const positions = root => ['whHigh', 'mia', 'tp', 'didLow', 'didHigh', 'whLow'].map(id => describeReplayNodePosition(root, id));
  assert.deepEqual(positions(xbar), ['Spec,CP', 'Spec,TP', 'complement of C', 'T⁰ in T′', 'T⁰ in C⁰', 'complement of V']);
  // Bare labels cannot tell a specifier from an adjunct, so that position stays neutral.
  assert.deepEqual(positions(bare), ['D in C', 'D in T', 'complement of C', 'T in T', 'T in C', 'complement of V']);
  // X-bar's plain P is the preposition head, so its sister NP is a complement.
  const pp = node('pp', 'PP', [node('pbar', 'P′', [word('p', 'P', 'with'), node('np', 'NP', [word('n', 'N', 'Mia')])])]);
  assert.equal(describeReplayNodePosition(pp, 'np'), 'complement of P');
  assert.equal(describeReplayNodePosition(toBareForest([pp])[0], 'np'), 'complement of P');
});

test('a word directly under a bare phrase keeps its authored casing, as under an X-bar phrase', () => {
  // "Mia, Leo saw": before fronting, Mia is a raw word inside the verb phrase.
  const clause = phrase => node('tp', phrase('T'), [node('leo', phrase('D'), [word('leoWord', 'Leo', 'Leo')]),
    node('vp', phrase('V'), [node('v', 'V', [word('saw', 'saw', 'saw')]), word('mia', 'Mia', 'Mia')])]);
  for (const phrase of [category => `${category}P`, category => category]) {
    const [step] = normalizeReplaySentenceInitialCasing([{ replayCanvasData: clause(phrase) }], 'Mia');
    assert.equal(find([step.replayCanvasData], 'mia').word, 'Mia', phrase('V'));
  }
});

test('an unnamed movement of a bare one-word phrase is phrasal, as its DP is in X-bar', () => {
  const clause = bare => [node('cp', bare ? 'C' : 'CP', [word('who', 'D[wh]', 'who', { lineageId: 'who' }),
    node('cbar', bare ? 'C' : 'C′', [node('c', 'C'), node('tp', bare ? 'T' : 'TP', [word('whoLow', bare ? 'D[wh]' : 'DP[wh]', 'who', { lineageId: 'who', silent: true }),
      node('tbar', bare ? 'T' : 'T′', [node('t', 'T'), node('vp', bare ? 'V' : 'VP', [word('left', 'V', 'left')])])])])])];
  for (const bare of [false, true]) assert.equal(inferHeadLikeTrajectoryKindFromForest({
    forest: clause(bare), targetNodeId: 'who', sourceNodeId: 'whoLow'
  }), 'phrasal', bare ? 'bare' : 'X-bar');
  const forest = toBareForest(question());
  assert.equal(inferHeadLikeTrajectoryKindFromForest({ forest, targetNodeId: 'didHigh', sourceNodeId: 'didLow' }), 'head');
});

test('a shifted bare one-word object is recovered as phrasal movement, as in X-bar', () => {
  const derivation = bare => {
    const label = (category, level) => bare ? category : `${category}${level}`;
    const v = (object, lower) => node('vP', label('v', 'P'), [word('mia', label('D', 'P'), 'Mia'), node('vbar', label('v', '′'), [node('vh', 'v'),
      ...(object ? [node('shifted', label('V', 'P'), [object, lower])] : [lower])])]);
    const vp = silent => node('vp', label('V', 'P'), [word('eat', 'V', 'eat'), word('itLow', label('D', 'P'), 'it', { lineageId: 'it', ...(silent ? { silent: true } : {}) })]);
    const stage = (workspaceForest, relations = []) => ({ statement: 'stage', stageRecord: 'stage', relations, workspaceForest });
    return { sentence: 'Mia it eat', derivationStages: [stage([v(null, vp(false))]),
      stage([v(word('it', label('D', 'P'), 'it', { lineageId: 'it' }), vp(true))], [{ relation: 'object shift', anchors: { landing: 'it', source: 'itLow' } }])] };
  };
  const kinds = bare => [...new Set(prepareReplay({ ...derivation(bare), includePlayback: false }).relationRenderPlan.frames
    .flatMap(frame => frame.items).filter(item => item.trajectoryKind).map(item => item.trajectoryKind))];
  assert.deepEqual(kinds(false), ['phrasal']);
  assert.deepEqual(kinds(true), kinds(false));
});

test('a one-word head beside a head over its own lower copy keeps the unnamed position', () => {
  // "mange" adjoined to v, with its lower copy as the complement of the pair:
  // [v [V v] V]. A complement and an adjoined head look alike here.
  const clause = node('vp', 'v', [word('je', 'D', 'Je'), node('vInner', 'v', [
    node('pair', 'v', [word('verbHigh', 'V', 'mange', { lineageId: 'verb' }), node('light', 'v')]),
    word('verbLow', 'V', 'mange', { lineageId: 'verb', silent: true })])]);
  assert.equal(describeReplayNodePosition(clause, 'verbHigh'), 'V in v');
  // A head and its one-word complement still name the complement.
  const plain = node('vp', 'v', [word('je', 'D', 'Je'), node('vInner', 'v', [node('light', 'v'), word('eat', 'V', 'mange')])]);
  assert.equal(describeReplayNodePosition(plain, 'eat'), 'complement of v');
  // The landing of a recovered head movement has adjoined, never a complement.
  assert.equal(describeReplayNodePosition(plain, 'eat', { headLanding: true }), 'V in v');
});
