/* Babel reads heads and construction order from the shape of a tree, never
 * from what a category is called or how its levels are written. */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { inferHeadLikeTrajectoryKindFromForest, isHeadLikeResolvedRelation } from '../replay/movementLinks.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { readStructuralHeads } from '../replay/structuralHeads.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, ...(children.length ? { children } : {}), ...extra });
const word = (id, label, text, extra = {}) => ({ id, label, word: text, ...extra });

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
const constructionOrder = root => prepareReplay({
  sentence: 'Mia will see the cat', includePlayback: true,
  derivationStages: [{ statement: 'Build the clause.', stageRecord: 'Build the clause.', relations: [], workspaceForest: [root] }]
}).playbackSteps.map(step => String(step.targetNodeId || '').replace(/::__leaf$/u, '')).filter(id => SHARED.has(id))
  .filter((id, index, ids) => ids.indexOf(id) === index);

test('every notation builds the same tree in the same structural order', () => {
  // Inside each projection the complement is built before its head merges
  // with it; the projection is built before its specifier.
  const expected = ['cat', 'the', 'dbar', 'see', 'vbar', 'will', 'tbar', 'mia', 'tp'];
  for (const [notation, build] of Object.entries(clause)) assert.deepEqual(constructionOrder(build()), expected, notation);
});

// Head X raises into the head Y above it: [YP [Y′ [Y X Y] [XP [X′ tX VP]]]].
const raising = (X, Y) => [node('yp', `${Y}P`, [node('ybar', `${Y}′`, [
  node('ycx', Y, [word('xHigh', X, 'ha', { lineageId: 'x' }), word('y', Y, 'ka')]),
  node('xp', `${X}P`, [node('xbar', `${X}′`, [word('xLow', X, 'ha', { lineageId: 'x', silent: true }),
    node('vp', 'VP', [word('v', 'V', 'mo')])])])])])];

test('a head raising into a complex head is head movement whatever the categories are called', () => {
  for (const [X, Y] of [['T', 'C'], ['Fin', 'Force'], ['Voice', 'Asp'], ['Foc', 'C'], ['Neg', 'T'], ['Appl', 'v']]) {
    const forest = raising(X, Y);
    assert.equal(inferHeadLikeTrajectoryKindFromForest({ forest, targetNodeId: 'xHigh', sourceNodeId: 'xLow' }), 'head', `${X} to ${Y}`);
    const nodeById = new Map(d3.hierarchy(forest[0]).descendants().map(entry => [entry.data.id, entry]));
    assert.equal(isHeadLikeResolvedRelation({ sourceNodeId: 'xLow', targetNodeId: 'xHigh', operation: 'raising' }, nodeById), true,
      `${X} to ${Y} at its moment`);
  }
  // The same shape with a phrase landing in a specifier stays phrasal.
  const phrasal = [node('yp', 'FocP', [node('dp', 'DP', [word('d', 'D', 'ha')], { lineageId: 'x' }), node('ybar', 'Foc′', [word('y', 'Foc', 'ka'),
    node('vp', 'VP', [word('v', 'V', 'mo'), node('dpLow', 'DP', [word('dLow', 'D', 'ha', { silent: true })], { lineageId: 'x' })])])])];
  assert.equal(inferHeadLikeTrajectoryKindFromForest({ forest: phrasal, targetNodeId: 'dp', sourceNodeId: 'dpLow' }), 'phrasal');
});

test('heads are read from shape, and a written level is respected', () => {
  const forest = [node('pp', 'PP', [node('pbar', 'P′', [word('p', 'P', 'with'), word('np', 'NP', 'Mia')]),
    word('trace', 'DP trace', 't'), word('gloss', 'DP（代词）', 'ta'), node('nbar', 'N-bar', [word('n', 'N', 'cat')])])];
  const heads = readStructuralHeads(forest);
  const at = id => d3.hierarchy(forest[0]).descendants().find(entry => entry.data.id === id).data;
  assert.equal(heads.isHead(at('p')), true, 'P is a preposition head, not a phrase');
  assert.equal(heads.projectingDaughter(at('pbar')), at('p'));
  assert.equal(heads.projectingDaughter(at('pp')), at('pbar'));
  for (const id of ['np', 'trace', 'gloss', 'nbar', 'pbar']) assert.equal(heads.isHead(at(id)), false, id);
});
