/* Babel reads projection levels from a tree's shape, not from how its labels
 * spell them. The same derivation written in X-bar notation (TP over T′),
 * Minimalist "XP over XP" (TP over TP) and bare labels (T over T) must name
 * the same heads and complements and recognize the same movements. Only X′
 * tells a specifier from an adjunct, so only X-bar names "Spec,"; the other
 * notations keep that position neutral ("DP in TP"). */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { readStructuralProjections } from '../replay/projectionStructure.ts';
import { buildReplayPanelContent } from '../replay/replayPanel.ts';
import { buildReplayDisplayDetailBlocks } from '../replay/replayPanelFormatting.ts';
import { describeReplayNodePosition } from '../replay/replayNodeDescription.ts';
import { panelText, tierLines } from './helpers/layoutSnapshot.mjs';

const node = (id, label, children = [], extra = {}) => ({ id, label, ...(children.length ? { children } : {}), ...extra });
const word = (id, label, text, extra = {}) => ({ id, label, word: text, ...extra });
const find = (forest, id) => forest.map(root => root.id === id ? root : find(root.children ?? [], id)).find(Boolean);

const NOTATIONS = {
  'X-bar': { max: category => `${category}P`, bar: category => `${category}′` },
  'XP over XP': { max: category => `${category}P`, bar: category => `${category}P` },
  bare: { max: category => category, bar: category => category }
};

// "What will Mia see": subject raising from Spec,vP to Spec,TP, then wh-movement
// to Spec,CP and T-to-C head movement.
const derivation = ({ max, bar }) => {
  const silent = { silent: true };
  const vp = low => node('vpInner', max('V'), [word('see', 'V', 'see'), word('whatLow', max('D'), 'what', { lineageId: 'what', ...(low ? silent : {}) })]);
  const vP = (low, whatLow) => node('vp', max('v'), [word('miaLow', max('D'), 'Mia', { lineageId: 'mia', ...(low ? silent : {}) }),
    node('vbar', bar('v'), [node('vHead', 'v'), vp(whatLow)])]);
  const tp = (low, whatLow) => node('tp', max('T'), [word('mia', max('D'), 'Mia', { lineageId: 'mia' }),
    node('tbar', bar('T'), [word('willLow', 'T', 'will', { lineageId: 'will', ...(low ? silent : {}) }), vP(true, whatLow)])]);
  const cp = node('cp', max('C'), [word('what', max('D'), 'what', { lineageId: 'what' }),
    node('cbar', bar('C'), [node('cHead', 'C', [word('willHigh', 'T', 'will', { lineageId: 'will' }), node('q', 'C')]), tp(true, true)])]);
  const stage = (workspaceForest, relations = []) => ({ statement: 'stage', stageRecord: 'stage', relations, workspaceForest });
  return {
    sentence: 'what will Mia see',
    derivationStages: [
      stage([vp(false)]),
      stage([vP(false, false)]),
      stage([tp(false, false)], [{ relation: 'raising', anchors: { landing: 'mia', source: 'miaLow' } }]),
      stage([cp], [{ relation: 'fronting', anchors: { landing: 'what', source: 'whatLow' } },
        { relation: 'inversion', anchors: { landing: 'willHigh', source: 'willLow' } }])
    ]
  };
};

const POSITIONS = ['what', 'willHigh', 'tp', 'mia', 'willLow', 'vp', 'miaLow', 'vpInner', 'see', 'whatLow'];
const finalTree = notation => derivation(notation).derivationStages.at(-1).workspaceForest[0];

const EXPECTED_POSITIONS = {
  'X-bar': ['Spec,CP', 'T in C', 'complement of C', 'Spec,TP', 'T in T′', 'complement of T', 'Spec,vP', 'complement of v', 'V in VP', 'DP in VP'],
  'XP over XP': ['DP in CP', 'T in C', 'complement of C', 'DP in TP', 'T in TP', 'complement of T', 'DP in vP', 'complement of v', 'V in VP', 'DP in VP'],
  bare: ['D in C', 'T in C', 'complement of C', 'D in T', 'T in T', 'complement of T', 'D in v', 'complement of v', 'V in V', 'D in V']
};

for (const [name, notation] of Object.entries(NOTATIONS)) {
  test(`${name}: positions read from structure`, () => {
    const root = finalTree(notation);
    assert.deepEqual(POSITIONS.map(id => describeReplayNodePosition(root, id)), EXPECTED_POSITIONS[name]);
  });
}

const prepared = notation => {
  const record = derivation(notation);
  return { record, replay: prepareReplay({ ...structuredClone(record), includePlayback: true }) };
};
const movements = replay => [...new Set(replay.relationRenderPlan.frames.flatMap(frame => frame.items)
  .filter(item => item.trajectoryKind).map(item => `${item.relationRef.stageIndex}:${item.relationRef.relationIndex} ${item.targetNodeId} ${item.trajectoryKind}`))].sort();
const sourceAndLanding = ({ record, replay }) => panelText({ buildReplayPanelContent, buildReplayDisplayDetailBlocks },
  replay.playbackSteps, record.derivationStages).filter(panel => panel.kind === 'relation')
  .map(panel => panel.lines.filter(([label]) => label === 'Source' || label === 'Landing')
    .map(([label, value]) => `${label}: ${value}`));

test('every notation recognizes the same movements; panel positions differ only where X′ names a specifier', () => {
  const [xbar, xp, bare] = Object.values(NOTATIONS).map(prepared);
  assert.deepEqual(movements(xbar.replay), ['2:0 mia phrasal', '3:0 what phrasal', '3:1 willHigh head']);
  for (const other of [xp, bare]) {
    assert.deepEqual(movements(other.replay), movements(xbar.replay));
    assert.deepEqual(tierLines(other.replay.relationRenderPlan), tierLines(xbar.replay.relationRenderPlan));
  }
  assert.deepEqual(sourceAndLanding(xbar), [['Source: Mia (Spec,vP)', 'Landing: Spec,TP'], ['Source: what (DP in VP)', 'Landing: Spec,CP'],
    ['Source: will (T in T′)', 'Landing: will (T) in C']]);
  assert.deepEqual(sourceAndLanding(xp), [['Source: Mia (DP in vP)', 'Landing: DP in TP'], ['Source: what (DP in VP)', 'Landing: DP in CP'],
    ['Source: will (T in TP)', 'Landing: will (T) in C']]);
  assert.deepEqual(sourceAndLanding(bare), [['Source: Mia (D in v)', 'Landing: D in T'], ['Source: what (D in V)', 'Landing: D in C'],
    ['Source: will (T in T)', 'Landing: will (T) in C']]);
});

// Labels without X′ cannot tell a specifier from an adjunct, so every phrase
// beside a projection stays "XP in YP", however many there are; the head's
// sister is still its complement.
const STRUCTURAL = { 'XP over XP': NOTATIONS['XP over XP'], bare: NOTATIONS.bare };
for (const [name, { max, bar }] of Object.entries(STRUCTURAL)) {
  const shell = (...outer) => outer.reduceRight((inner, phrase) => node(`seg${phrase.id}`, bar('v'), [phrase, inner]),
    node('vbar', bar('v'), [node('vHead', 'v'), node('vpInner', max('V'), [word('see', 'V', 'see'), word('obj', max('D'), 'it')])]));
  const root = (...outer) => { const top = shell(...outer); return { ...top, id: 'top', label: max('v') }; };
  const describe = (tree, ids) => ids.map(id => describeReplayNodePosition(tree, id));

  test(`${name}: an adjunct above a specifier and the specifier both stay neutral`, () => {
    const tree = root(word('adv', max('Adv'), 'often'), word('subject', max('D'), 'Mia'));
    assert.deepEqual(describe(tree, ['adv', 'subject', 'vpInner']), [`${max('Adv')} in ${max('v')}`, `${max('D')} in ${bar('v')}`, 'complement of v']);
  });

  test(`${name}: multiple specifiers all stay neutral`, () => {
    const tree = root(word('outer', max('D'), 'what'), word('inner', max('D'), 'Mia'));
    assert.deepEqual(describe(tree, ['outer', 'inner', 'vpInner']), [`${max('D')} in ${max('v')}`, `${max('D')} in ${bar('v')}`, 'complement of v']);
  });

  test(`${name}: a single phrase beside the projection stays neutral`, () => {
    const tree = root(word('subject', max('D'), 'Mia'));
    assert.deepEqual(describe(tree, ['subject', 'vpInner']), [`${max('D')} in ${max('v')}`, 'complement of v']);
  });
}

test('mixed notation: only the X′ projection names its specifier, in every stage', () => {
  // T is written with T′, v as vP over vP: the vP edge is unsupported in the
  // stage without X′ and in the stage with it.
  const vP = () => node('vp', 'vP', [word('miaLow', 'DP', 'Mia'), node('vbar', 'vP', [node('vHead', 'v'),
    node('vpInner', 'VP', [word('see', 'V', 'see'), word('obj', 'DP', 'it')])])]);
  const early = vP();
  const late = node('tp', 'TP', [word('mia', 'DP', 'Mia'), node('tbar', 'T′', [word('will', 'T', 'will'), vP()])]);
  assert.equal(describeReplayNodePosition(early, 'miaLow'), 'DP in vP');
  assert.equal(describeReplayNodePosition(early, 'vpInner'), 'complement of v');
  assert.equal(describeReplayNodePosition(late, 'miaLow'), 'DP in vP');
  assert.equal(describeReplayNodePosition(late, 'mia'), 'Spec,TP');
  assert.equal(describeReplayNodePosition(late, 'vp'), 'complement of T');
});

test('XP over XP reads segments: a daughter of its own category projects, one of another category is maximal', () => {
  const forest = [finalTree(NOTATIONS['XP over XP'])], at = id => find(forest, id);
  const reader = readStructuralProjections(forest);
  const level = id => `${reader.minimal(at(id)) ? 'min' : ''}${reader.maximal(at(id)) ? 'max' : ''}` || 'bar';
  assert.deepEqual(['cp', 'cbar', 'cHead', 'tp', 'tbar', 'willLow', 'vp', 'vbar', 'vpInner', 'mia'].map(level),
    ['max', 'bar', 'min', 'max', 'bar', 'min', 'max', 'bar', 'max', 'max']);
  assert.equal(reader.positionKind(at('mia')), 'phrasal');
});

test('X-bar adjunction and bare head adjunction stay unnamed', () => {
  // VP adjoined to VP: X-bar's repeated VP marks an adjunct, not a specifier.
  const adjoined = node('top', 'TP', [word('subject', 'DP', 'Mia'), node('tbar', 'T′', [node('t', 'T'),
    node('vpTop', 'VP', [node('vpLow', 'VP', [node('vbar', 'V′', [word('v', 'V', 'left')])]),
      node('pp', 'PP', [node('pbar', 'P′', [word('p', 'P', 'early')])])])])]);
  assert.equal(readStructuralProjections([adjoined]), undefined, 'X′ labels state the levels');
  assert.equal(describeReplayNodePosition(adjoined, 'pp'), 'PP in VP');
  assert.equal(describeReplayNodePosition(adjoined, 'vpTop'), 'complement of T');
  // A head adjoined to a head over its own lower copy keeps the unnamed position.
  for (const phrase of [category => category, category => `${category}P`]) {
    const clause = node('vP', phrase('v'), [word('je', phrase('D'), 'Je'), node('vInner', phrase('v'), [
      node('pair', 'v', [word('verbHigh', 'V', 'mange', { lineageId: 'verb' }), node('light', 'v')]),
      word('verbLow', 'V', 'mange', { lineageId: 'verb', silent: true })])]);
    assert.equal(describeReplayNodePosition(clause, 'verbHigh'), 'V in v', phrase('v'));
  }
});

test('a phrase label settles a one-word item as a phrase, where structure leaves it open', () => {
  // A one-word clitic adjoined to T over its own lower copy: bare D reads as a
  // head inside the complex T, an authored DP as a phrase.
  const clause = label => [node('tp', 'TP', [node('cluster', 'T', [word('cl', label, 'lo', { lineageId: 'lo' }), node('t', 'T')]),
    node('vp', 'VP', [word('v', 'V', 'vedo'), word('clLow', label, 'lo', { lineageId: 'lo', silent: true })])])];
  const kind = label => {
    const forest = clause(label), reader = readStructuralProjections(forest);
    return [reader.minimal(find(forest, 'cluster')), reader.minimal(find(forest, 'cl')), reader.positionKind(find(forest, 'cl'))];
  };
  assert.deepEqual(kind('D'), [true, true, 'head']);
  assert.deepEqual(kind('DP'), [true, false, undefined]);
});
