/* Babel reads heads from the shape of a tree, never from what a category is
 * called. */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { inferHeadLikeTrajectoryKindFromForest, isHeadLikeResolvedRelation } from '../replay/movementLinks.ts';
import { readStructuralHeads } from '../replay/structuralHeads.ts';

const node = (id, label, children = [], extra = {}) => ({ id, label, ...(children.length ? { children } : {}), ...extra });
const word = (id, label, text, extra = {}) => ({ id, label, word: text, ...extra });

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

// "Mia, Leo saw": a one-word phrase fronted to a specifier, as X-bar,
// XP-over-XP and bare labels write it. The word is a phrase, not a head.
const fronted = (notation, label) => {
  const level = (category, bar) => notation === 'bare' ? category : `${category}${bar}`;
  const inner = notation === 'xbar' ? 'C′' : level('C', 'P');
  return [node('cp', level('C', 'P'), [word('miaHigh', label, 'Mia', { lineageId: 'mia' }), node('cbar', inner, [node('c', 'C'),
    node('tp', level('T', 'P'), [word('leo', label, 'Leo'), node('tbar', notation === 'xbar' ? 'T′' : level('T', 'P'), [node('t', 'T'),
      node('vp', level('V', 'P'), [word('saw', 'V', 'saw'), word('miaLow', label, 'Mia', { lineageId: 'mia', silent: true })])])])])])];
};

test('a fronted one-word phrase is phrasal movement in every notation', () => {
  for (const notation of ['xbar', 'xpOverXp', 'bare']) for (const label of ['Mia', 'Pron', 'D', 'N']) {
    const forest = fronted(notation, label);
    assert.equal(inferHeadLikeTrajectoryKindFromForest({ forest, targetNodeId: 'miaHigh', sourceNodeId: 'miaLow' }), 'phrasal',
      `${label} in ${notation}`);
    const nodeById = new Map(d3.hierarchy(forest[0]).descendants().map(entry => [entry.data.id, entry]));
    assert.equal(isHeadLikeResolvedRelation({ sourceNodeId: 'miaLow', targetNodeId: 'miaHigh', operation: 'fronting' }, nodeById), false,
      `${label} in ${notation} at its moment`);
  }
});

test('heads are read from shape, and a written level is respected', () => {
  const forest = [node('pp', 'PP', [node('pbar', 'P′', [word('p', 'P', 'with'), word('np', 'NP', 'Mia')]),
    word('trace', 'DP trace', 't'), word('gloss', 'DP（代词）', 'ta'), node('nbar', 'N-bar', [word('n', 'N', 'cat')])])];
  const heads = readStructuralHeads(forest);
  const at = id => d3.hierarchy(forest[0]).descendants().find(entry => entry.data.id === id).data;
  assert.equal(heads.isHead(at('p')), true, 'P is a preposition head, not a phrase');
  assert.equal(heads.isHead(at('n')), true);
  for (const id of ['np', 'trace', 'gloss', 'nbar', 'pbar']) assert.equal(heads.isHead(at(id)), false, id);
});
