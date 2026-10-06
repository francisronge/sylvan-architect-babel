import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceVisualScore, compareWorkspaceVisualScores, workspaceGapProposals,
  adjustWorkspaceGapPreference, workspaceRealizedGap, workspaceFinalWidth, keepsWorkspaceFinalWidth, keepsWorkspaceFinalExtent, workspaceVisualSummary } from '../replay/workspaceVisualScore.ts';

const tree = (id, ...children) => ({ id, children });
const points = entries => new Map(entries.map(([id, x, y = 0]) => [id, { x, y }]));
function frame(roots, positions) {
  const nodes = new Map();
  const visit = node => {
    const children = node.children.map(visit), origin = positions.get(node.id);
    const members = new Map([[node.id, { x: 0, y: 0 }]]);
    for (const child of children) for (const [id, point] of child.members) {
      const offset = positions.get(child.id);
      members.set(id, { x: point.x + offset.x - origin.x, y: point.y + offset.y - origin.y });
    }
    const result = { id: node.id, incarnation: nodes.size, first: 0, last: 0, children, members, obstacles: [] };
    nodes.set(node.id, result); return result;
  };
  return { roots: roots.map(visit), nodes, step: {} };
}
const root = tree('p', tree('small', tree('a'), tree('b')), tree('right'));
const reference = points([['p', 0], ['small', -500, 210], ['a', -510, 420], ['b', -490, 420], ['right', 500, 210]]);

const metrics = ({ local = [.5], drift = .01, width = .01, aggregate = 10, roots } = {}) => ({
  localDistortions: local, rootDisplacement: drift, widthDeviation: width, squaredDisplacement: aggregate,
  maxX: drift * 1000, roots: roots ?? new Map([['root', { widthError: width * 1000, maxX: drift * 1000 }]])
});

test('local improvement cannot purchase worse final width or root displacement', () => {
  const before = metrics({ local: [2.490], drift: 425.967 / 3282.669, width: .1186 });
  const after = metrics({ local: [2.018], drift: 1252.194 / 3282.669, width: .3139, aggregate: 1 });
  assert.equal(compareWorkspaceVisualScores(after, before), 1);
  assert.equal(keepsWorkspaceFinalExtent(after, before), false);
});
test('a balanced-score improvement is still refused when final width worsens', () => {
  const before = metrics({ local: [.5], width: .01 }), after = metrics({ local: [.4], width: .02 });
  assert.equal(compareWorkspaceVisualScores(after, before), -1);
  assert.equal(keepsWorkspaceFinalExtent(after, before), false);
});
test('a balanced-score improvement is still refused when root drift worsens', () => {
  const before = metrics({ local: [.5], drift: .01 }), after = metrics({ local: [.4], drift: .02 });
  assert.equal(compareWorkspaceVisualScores(after, before), -1);
  assert.equal(keepsWorkspaceFinalExtent(after, before), false);
});
test('closer local proportions with preserved final extent are eligible', () => {
  const before = metrics(), after = metrics({ local: [.4], aggregate: 1000 });
  assert.equal(compareWorkspaceVisualScores(after, before), -1);
  assert.equal(keepsWorkspaceFinalExtent(after, before), true);
});
test('a small root cannot worsen behind the unchanged maximum of a large root', () => {
  const before = metrics({ roots: new Map([['small', { widthError: 10, maxX: 20 }], ['large', { widthError: 1000, maxX: 2000 }]]) });
  const after = metrics({ roots: new Map([['small', { widthError: 30, maxX: 40 }], ['large', { widthError: 1000, maxX: 2000 }]]) });
  assert.equal(keepsWorkspaceFinalExtent(after, before), false);
  assert.equal(keepsWorkspaceFinalExtent(metrics(), before), false);
});
test('balanced ranking uses the existing local and root preference scales', () => {
  const local = metrics({ local: [.20], drift: .01, width: 0 });
  const global = metrics({ local: [.10], drift: .03, width: 0 });
  assert.equal(compareWorkspaceVisualScores(local, global), -1);
});
test('aggregate error remains only a final tie-break', () => {
  const before = metrics();
  assert.equal(compareWorkspaceVisualScores({ ...before, squaredDisplacement: 9 }, before), -1);
  assert.equal(compareWorkspaceVisualScores(before, before), 0);
});
test('rounding in an unchanged dominant fork does not hide a narrower, closer plan', () => {
  const before = metrics({ local: [2.4895151447343133, 2.4895151447343133, 2.4895151447343125],
    drift: 504.713 / 3282.669, width: .157, aggregate: 900 });
  const after = metrics({ local: [2.4895151447343133, 2.4895151447343133, 2.4895151447343133],
    drift: 425.967 / 3282.669, width: .1186, aggregate: 700 });
  assert.equal(compareWorkspaceVisualScores(after, before), -1);
  assert.equal(compareWorkspaceVisualScores(before, after), 1);
  assert.equal(keepsWorkspaceFinalExtent(after, before), true);
});
test('preference roundoff does not mask a substantive dominant error', () => {
  const before = metrics({ local: [2.49], aggregate: 1000 });
  const after = metrics({ local: [2.49 + 1e-10], aggregate: 1 });
  assert.equal(compareWorkspaceVisualScores(after, before), 1);
});
test('equal unbounded errors still allow finite dimensions to decide', () => {
  const before = metrics({ local: [Infinity, .5], aggregate: 1 });
  const after = metrics({ local: [Infinity, .4], aggregate: 1000 });
  assert.equal(compareWorkspaceVisualScores(after, before), -1);
  assert.equal(compareWorkspaceVisualScores(after, after), 0);
});
test('actual score includes width deviation and per-root world-coordinate caps', () => {
  const after = new Map(reference);
  after.set('small', { x: -600, y: 210 }); after.set('a', { x: -610, y: 420 });
  after.set('b', { x: -590, y: 420 }); after.set('right', { x: 600, y: 210 });
  const score = workspaceVisualScore(frame([root], after), reference);
  assert.equal(score.roots.get('p').widthError, 200);
  assert.equal(score.roots.get('p').maxX, 100);
  assert.equal(score.widthDeviation, 200 / 1010);
  assert.equal(score.rootDisplacement, 100 / 1010);
});
test('score is independent of whole-tree translation, reflection and opaque IDs', () => {
  const expected = workspaceVisualScore(frame([root], reference), reference);
  const transform = map => new Map([...map].map(([id, point]) => ['id/' + id, { x: 1000 - point.x, y: point.y + 700 }]));
  const renamed = part => tree('id/' + part.id, ...part.children.map(renamed));
  const positions = transform(reference), actual = workspaceVisualScore(frame([renamed(root)], positions), positions);
  assert.deepEqual(workspaceVisualSummary(actual), workspaceVisualSummary(expected));
  assert.deepEqual([...actual.roots.values()], [...expected.roots.values()]);
});
test('zero-span changes compare and serialize explicitly without NaN', () => {
  const roots = [tree('p', tree('left'), tree('middle'), tree('right'))];
  const before = points([['p', 0], ['left', -500, 210], ['middle', 0, 210], ['right', 500, 210]]);
  const after = new Map(before); after.set('middle', { x: 100, y: 210 });
  const changed = workspaceVisualScore(frame(roots, after), before), original = workspaceVisualScore(frame(roots, before), before);
  assert.equal(changed.localDistortions[0], Infinity);
  assert.equal(compareWorkspaceVisualScores(changed, changed), 0);
  assert.equal(compareWorkspaceVisualScores(changed, original), 1);
  assert.equal(workspaceVisualSummary(changed).worstLocal, 'unbounded');
});
test('missing and nonfinite reference geometry cannot receive a preference score', () => {
  const missing = new Map(reference); missing.delete('a');
  assert.equal(workspaceVisualScore(frame([root], reference), missing), undefined);
  const invalid = new Map(reference); invalid.set('a', { x: NaN, y: 420 });
  assert.equal(workspaceVisualScore(frame([root], invalid), reference), undefined);
});
test('sub-epsilon world-coordinate noise does not reorder exact poses', () => {
  const noisy = new Map(reference); noisy.set('a', { x: -510 + 1e-8, y: 420 });
  assert.equal(compareWorkspaceVisualScores(workspaceVisualScore(frame([root], noisy), reference), workspaceVisualScore(frame([root], reference), reference)), 0);
});
test('the exact old gap is tried within the original three-proposal budget', () => {
  assert.deepEqual(workspaceGapProposals(1000, 913), [913, 750, 1500]);
  assert.deepEqual(workspaceGapProposals(1000, 1000), [750, 1500, 250]);
  assert.deepEqual(workspaceGapProposals(1000, 750), [750, 1500, 250]);
  assert.deepEqual(workspaceGapProposals(1000, NaN), [750, 1500, 250]);
});
test('proposals target the actual final fork instead of its unfulfilled preferred gap', () => {
  const roots = [tree('p', tree('a'), tree('b'))];
  const prior = frame(roots, points([['p', 0], ['a', -20, 210], ['b', 20, 210]]));
  const current = frame(roots, points([['p', 0], ['a', -200, 210], ['b', 200, 210]]));
  const finalReference = points([['p', 0], ['a', -100, 210], ['b', 100, 210]]);
  const realized = workspaceRealizedGap(prior.roots[0], 1, [prior, current], finalReference, points([['a', -20], ['b', 20]]));
  assert.deepEqual(realized, { current: 400, reference: 200 });
  assert.equal(workspaceGapProposals(realized.current, realized.reference)[0], 200);
});
test('an earlier-only fork uses its own complete occurrence and reference', () => {
  const prior = frame([tree('p', tree('a'), tree('b'))], points([['p', 0], ['a', -200, 210], ['b', 200, 210]]));
  const final = frame([tree('other', tree('c'), tree('d'))], points([['other', 0], ['c', -700, 210], ['d', 700, 210]]));
  assert.deepEqual(workspaceRealizedGap(prior.roots[0], 1, [prior, final], new Map(), points([['a', -100], ['b', 100]])), { current: 400, reference: 200 });
});
test('reused parent ID with different current children cannot lend its final gap', () => {
  const prior = frame([tree('p', tree('a'), tree('b'))], points([['p', 0], ['a', -200, 210], ['b', 200, 210]]));
  const final = frame([tree('p', tree('c'), tree('d'))], points([['p', 0], ['c', -700, 210], ['d', 700, 210]]));
  assert.deepEqual(workspaceRealizedGap(prior.roots[0], 1, [prior, final], new Map(), points([['a', -100], ['b', 100]])), { current: 400, reference: 200 });
});

test('independent final roots cannot spread farther apart behind unchanged local widths', () => {
  const reference = points([['a', 0], ['b', 1000]]), accepted = points([['a', -100], ['b', 1100]]);
  const expanded = points([['a', -200], ['b', 1200]]), better = points([['a', -50], ['b', 1050]]);
  assert.equal(keepsWorkspaceFinalWidth(workspaceFinalWidth(expanded), workspaceFinalWidth(accepted), workspaceFinalWidth(reference)), false);
  assert.equal(keepsWorkspaceFinalWidth(workspaceFinalWidth(better), workspaceFinalWidth(accepted), workspaceFinalWidth(reference)), true);
  assert.equal(keepsWorkspaceFinalWidth(1, 0, NaN), false);
});


test('a realized target adjusts the stored preference by its composed residual', () => {
  const stored = points([['parent', 0], ['a', -1895, 210], ['b', 1895, 210]]);
  const result = adjustWorkspaceGapPreference(stored, ['a', 'b'], 1, 3424, 1096);
  assert.equal(result.get('b').x - result.get('a').x, 1462);
  // Composition retains the same -366 offset for this local candidate.
  assert.equal(result.get('b').x - result.get('a').x - 366, 1096);
  assert.deepEqual(stored, points([['parent', 0], ['a', -1895, 210], ['b', 1895, 210]]));
  assert.deepEqual(result.get('parent'), stored.get('parent'));
});
test('a gap adjustment preserves both sister groups and their current row', () => {
  const stored = points([['p', 0], ['a', -900, 210], ['b', -700, 210], ['c', 700, 210], ['d', 1000, 210]]);
  const result = adjustWorkspaceGapPreference(stored, ['a', 'b', 'c', 'd'], 2, 1200, 600);
  assert.equal(result.get('c').x - result.get('b').x, 800);
  assert.equal(result.get('b').x - result.get('a').x, 200);
  assert.equal(result.get('d').x - result.get('c').x, 300);
  assert.equal(result.get('b').x + result.get('c').x, 0);
  assert.deepEqual([...result.values()].map(point => point.y), [...stored.values()].map(point => point.y));
});
test('matching preferred and realized gaps retain direct target behavior', () => {
  const stored = points([['a', -200, 210], ['b', 200, 210]]);
  const result = adjustWorkspaceGapPreference(stored, ['a', 'b'], 1, 400, 800);
  assert.deepEqual(result, points([['a', -400, 210], ['b', 400, 210]]));
});
test('unrepresentable gap corrections cannot create reversed stored slots', () => {
  const stored = points([['a', -100, 210], ['b', 100, 210]]);
  assert.equal(adjustWorkspaceGapPreference(stored, ['a', 'b'], 1, 1000, 100), undefined);
  assert.equal(adjustWorkspaceGapPreference(stored, ['a', 'b'], 0, 200, 100), undefined);
  assert.equal(adjustWorkspaceGapPreference(stored, ['a', 'missing'], 1, 200, 100), undefined);
  assert.equal(adjustWorkspaceGapPreference(stored, ['a', 'b'], 1, NaN, 100), undefined);
});
