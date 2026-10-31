/* Construction follows bottom-up Merge, read from the tree's shape: a head's
 * complement is built before the head merges with it, and a projection is
 * built before its specifier or adjunct, whatever the categories are called
 * and however the levels are written. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareReplay } from '../replay/prepareReplay.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, ...(children.length ? { children } : {}), ...extra });
const word = (id, label, text, extra = {}) => ({ id, label, word: text, ...extra });

const constructionOrder = (sentence, root, ids) => prepareReplay({
  sentence, includePlayback: true,
  derivationStages: [{ statement: 'Build the clause.', stageRecord: 'Build the clause.', relations: [], workspaceForest: [root] }]
}).playbackSteps.map(step => String(step.targetNodeId || '').replace(/::__leaf$/u, '')).filter(id => ids.has(id))
  .filter((id, index, list) => list.indexOf(id) === index);

// "Mia will see the cat" in three notations. X-bar adds non-branching VP and
// DP over V′ and D′; the other nodes share ids across notations.
const clause = {
  xbar: () => node('tp', 'TP', [word('mia', 'DP', 'Mia'), node('tbar', 'T′', [word('will', 'T', 'will'),
    node('vp', 'VP', [node('vbar', 'V′', [word('see', 'V', 'see'),
      node('dp', 'DP', [node('dbar', 'D′', [word('the', 'D', 'the'), word('cat', 'NP', 'cat')])])])])])]),
  xpOverXp: () => node('tp', 'TP', [word('mia', 'DP', 'Mia'), node('tbar', 'TP', [word('will', 'T', 'will'),
    node('vbar', 'VP', [word('see', 'V', 'see'), node('dbar', 'DP', [word('the', 'D', 'the'), word('cat', 'NP', 'cat')])])])]),
  bare: () => node('tp', 'T', [word('mia', 'D', 'Mia'), node('tbar', 'T', [word('will', 'T', 'will'),
    node('vbar', 'V', [word('see', 'V', 'see'), node('dbar', 'D', [word('the', 'D', 'the'), word('cat', 'N', 'cat')])])])])
};
const SHARED = new Set(['tp', 'mia', 'tbar', 'will', 'vbar', 'see', 'dbar', 'the', 'cat']);

test('every notation builds a clause complement first, then its specifier', () => {
  const expected = ['cat', 'the', 'dbar', 'see', 'vbar', 'will', 'tbar', 'mia', 'tp'];
  for (const [notation, build] of Object.entries(clause))
    assert.deepEqual(constructionOrder('Mia will see the cat', build(), SHARED), expected, notation);
});

// Categories the old label table never listed are read the same way:
// [TopP DP [Top′ Top [FocP KP [Foc′ Foc VP]]]].
test('unlisted categories build complement, head, then specifier', () => {
  const root = node('top', 'TopP', [word('mia', 'DP', 'Mia'), node('topbar', 'Top′', [word('ka', 'Top', 'ka'),
    node('foc', 'FocP', [word('kp', 'KP', 'ni'), node('focbar', 'Foc′', [word('wa', 'Foc', 'wa'), word('vp', 'VP', 'mo')])])])]);
  const ids = new Set(['top', 'mia', 'topbar', 'ka', 'foc', 'kp', 'focbar', 'wa', 'vp']);
  assert.deepEqual(constructionOrder('Mia ka ni wa mo', root, ids),
    ['vp', 'wa', 'focbar', 'kp', 'foc', 'ka', 'topbar', 'mia', 'top']);
});

// An adjunct joins a projection that is already built: [VP AdvP [VP V DP]].
test('an adjunct attaches to a built projection', () => {
  const root = node('vp', 'VP', [word('adv', 'AdvP', 'often'), node('vlow', 'VP', [word('see', 'V', 'see'), word('obj', 'DP', 'Mia')])]);
  assert.deepEqual(constructionOrder('often see Mia', root, new Set(['vp', 'adv', 'vlow', 'see', 'obj'])),
    ['obj', 'see', 'vlow', 'adv', 'vp']);
});

// A wh-object is built before the verb that selects it, then fronted:
// "Which book did Mia return?". Its base position follows the verb, so it never
// takes the sentence's capital there, not even while it is the only phrase
// built; the capital belongs to the fronted copy.
test('a base object built before its verb keeps the lowercase form until it is fronted', () => {
  const object = (suffix, silent) => node(`dp${suffix}`, 'D', [word(`which${suffix}`, 'D', 'Which', { lineageId: 'which', ...(silent ? { silent } : {}) }),
    word(`book${suffix}`, 'N', 'book', { lineageId: 'book', ...(silent ? { silent } : {}) })], { lineageId: 'obj' });
  const vp = low => node('vp', 'V', [word('return', 'V', 'return'), low]);
  const stages = [
    { statement: 'Return selects its object.', stageRecord: 'The object is built in its base position.', relations: [], workspaceForest: [vp(object('Low'))] },
    { statement: 'The object fronts.', stageRecord: 'Wh-movement.', workspaceForest: [node('cp', 'C', [object('High'),
      node('cbar', 'C', [word('did', 'C', 'did'), node('tp', 'T', [word('mia', 'D', 'Mia'), node('tbar', 'T', [word('t', 'T', 'did', { silent: true }), vp(object('Low', true))])])])])],
    relations: [{ relation: 'WhMove', anchors: { lowerCopy: 'dpLow', pronouncedCopy: 'dpHigh' } }] }
  ];
  const steps = prepareReplay({ sentence: 'Which book did Mia return?', includePlayback: true, derivationStages: stages }).playbackSteps;
  const find = (root, id) => root?.id === id ? root : root?.children?.map(child => find(child, id)).find(Boolean);
  const shown = steps.map(step => [step.replayProgressLabel, find(step.replayCanvasData, 'whichLow::__leaf')?.label,
    (step.replayVisibleNodeIds || []).includes('whichLow::__leaf')]);
  const baseForms = new Set(shown.filter(([label, , visible]) => String(label).startsWith('Stage 1/') && visible).map(([, form]) => form));
  assert.deepEqual([...baseForms], ['which'], 'the base object is never capitalised');
  const high = steps.map(step => find(step.replayCanvasData, 'whichHigh::__leaf')?.label).filter(Boolean);
  assert.equal(high.at(-1), 'Which', 'the fronted copy carries the capital');
});
