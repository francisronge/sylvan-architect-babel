import assert from 'node:assert/strict';
import test from 'node:test';

import { expandPartsListAnalysis } from '../server/babelParser/partsList.js';
import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';

const stage = (workspace, nodes, extra = {}) => ({ statement: 's', stageRecord: 'r', relations: [], nodes, workspace, ...extra });
const words = (node) => node.children?.length ? node.children.flatMap(words) : [node];

// Copy theory without retyping: Opus chose traces because a full lower copy
// needed new ids for every node inside it (thinking traces, n3-67, 27 Oct).
test('a copy entry is a new occurrence with the copied structure', () => {
  const analysis = { derivationStages: [
    stage(['dp'], [
      { children: [], id: 'd', label: 'D', word: 'whose' },
      { children: [], id: 'n', label: 'N', word: 'car' },
      { children: ['d', 'n'], id: 'dp', label: 'D', lineageId: 'wc' }
    ]),
    stage(['vp'], [{ id: 'v', label: 'V', word: 'stolen' }, { children: ['v', 'dp'], id: 'vp', label: 'V' }]),
    stage(['tp'], [
      { id: 'low', copyOf: 'dp', silent: true },
      { children: ['v', 'low'], id: 'vp', label: 'V' },
      { id: 't', label: 'T', word: 'was' },
      { children: ['t', 'vp'], id: 'tbar', label: 'T' },
      { children: ['dp', 'tbar'], id: 'tp', label: 'T' }
    ])
  ] };
  const { analysis: expanded, issue } = expandPartsListAnalysis(analysis);
  assert.equal(issue, undefined);
  const [tp] = expanded.derivationStages[2].workspaceForest;
  const low = tp.children[1].children[1].children[1];
  assert.deepEqual([low.id, low.label, low.silent, low.lineageId], ['low', 'D', true, 'wc']);
  assert.deepEqual(words(low).map(leaf => [leaf.id, leaf.label, leaf.word]), [['low/d', 'D', 'whose'], ['low/n', 'N', 'car']]);
  assert.equal(Object.hasOwn(low, 'copyOf'), false);
  // The copied descendants keep their names in later stages.
  const later = expandPartsListAnalysis({ derivationStages: [...analysis.derivationStages,
    stage(['cp'], [{ id: 'c', label: 'C', silent: true }, { children: ['c', 'tp'], id: 'cp', label: 'C' }])] });
  const laterLow = later.analysis.derivationStages[3].workspaceForest[0].children[1].children[1].children[1].children[1];
  assert.deepEqual(words(laterLow).map(leaf => leaf.id), ['low/d', 'low/n']);
});

test('a copy entry takes no children, no other word, and copies a defined node other than itself', () => {
  const base = [{ id: 'n', label: 'N', word: 'car' }];
  const issueOf = (entry) => expandPartsListAnalysis({ derivationStages: [stage(['n'], base), stage(['n', 'k'], [entry])] }).issue;
  assert.match(issueOf({ id: 'k', copyOf: 'n', children: [] }).message, /no children/);
  // Sol restated the copied node's own word (n3-37, n4-17, sol-cfc 27 Oct): that changes nothing.
  assert.equal(issueOf({ id: 'k', copyOf: 'n', word: 'car' }), undefined);
  assert.match(issueOf({ id: 'k', copyOf: 'n', word: 'bus' }).message, /no word, or the copied node's own word "car"/);
  assert.match(issueOf({ id: 'k', copyOf: 'missing' }).message, /no node "missing"/);
  assert.match(issueOf({ id: 'k', copyOf: 'k' }).message, /copies itself/);
  assert.match(issueOf({ id: 'k', copyOf: '' }).message, /copyOf/);
});

test('a copy may copy a copy listed in the same stage', () => {
  const { analysis, issue } = expandPartsListAnalysis({ derivationStages: [
    stage(['dp'], [{ id: 'n', label: 'N', word: 'car' }, { children: ['n'], id: 'dp', label: 'D' }]),
    stage(['dp', 'b', 'a'], [{ id: 'b', copyOf: 'a', silent: true }, { id: 'a', copyOf: 'dp' }])
  ] });
  assert.equal(issue, undefined);
  const [, b] = analysis.derivationStages[1].workspaceForest;
  assert.deepEqual([b.silent, b.children[0].id, b.children[0].word], [true, 'b/a/n', 'car']);
});

test('copies that contain one another, or themselves through the copied node, fail', () => {
  const base = stage(['dp'], [{ id: 'n', label: 'N', word: 'car' }, { children: ['n'], id: 'dp', label: 'D' }]);
  const issueOf = (nodes, workspace = ['dp']) => expandPartsListAnalysis({ derivationStages: [base, stage(workspace, nodes)] }).issue;
  assert.match(issueOf([{ id: 'a', copyOf: 'b' }, { id: 'b', copyOf: 'a' }], ['dp', 'a', 'b']).message, /contains itself through the node it copies/);
  assert.match(issueOf([{ id: 'low', copyOf: 'dp' }, { children: ['n', 'low'], id: 'dp', label: 'D' }]).message,
    /contains itself through the node it copies/);
});

test('a copy whose descendant id this stage also lists fails', () => {
  const { issue } = expandPartsListAnalysis({ derivationStages: [
    stage(['dp'], [{ id: 'n', label: 'N', word: 'car' }, { children: ['n'], id: 'dp', label: 'D' }]),
    stage(['dp', 'low'], [{ id: 'low', copyOf: 'dp' }, { id: 'low/n', label: 'N', word: 'car' }])
  ] });
  assert.match(issue.message, /would name a descendant "low\/n", which this stage also lists/);
});

test('copyOf belongs to the parts list: a nested analysis is returned unchanged', () => {
  const nested = { derivationStages: [{ statement: 's', stageRecord: 'r', relations: [],
    workspaceForest: [{ id: 'n', label: 'N', word: 'car', copyOf: 'm', children: [] }] }] };
  const result = expandPartsListAnalysis(nested);
  assert.equal(result.form, 'nested');
  assert.equal(result.analysis, nested);
});

test('an analysis written with copyOf parses like one that writes the copy out', () => {
  const normalize = (derivationStages) => normalizeParseBundle({ derivationStages }, 'minimalism', 'Mia was seen.', 'gpt', true, { spellout: true });
  const first = [
    stage(['dp'], [{ id: 'n', label: 'N', word: 'Mia' }, { children: ['n'], id: 'dp', label: 'D', lineageId: 'mia' }]),
    stage(['vp'], [{ id: 'v', label: 'V', word: 'seen' }, { children: ['v', 'dp'], id: 'vp', label: 'V' }])
  ];
  const last = (low) => stage(['tp'], [
    ...low, { children: ['v', 'low'], id: 'vp', label: 'V' }, { id: 't', label: 'T', word: 'was' },
    { children: ['t', 'vp'], id: 'tbar', label: 'T' }, { children: ['dp', 'tbar'], id: 'tp', label: 'T' }
  ]);
  const copied = normalize([...first, last([{ id: 'low', copyOf: 'dp', silent: true }])]);
  const written = normalize([...first, last([
    { id: 'low/n', label: 'N', word: 'Mia' }, { children: ['low/n'], id: 'low', label: 'D', lineageId: 'mia', silent: true }
  ])]);
  assert.deepEqual(copied.inputTokens, ['Mia', 'was', 'seen']);
  const trees = bundle => bundle.analyses.map(analysis => analysis.derivationStages.map(entry => entry.workspaceForest));
  assert.deepEqual(trees(copied), trees(written));
});

test('both frameworks explain copyOf', () => {
  for (const framework of ['xbar', 'minimalism']) {
    assert.match(buildSystemInstruction(framework), /- copyOf is the id of a node defined in this or an earlier stage\./);
  }
});

// Codex review on #340: a source that lists one child several times made the
// copy walk that subtree once per listing, so 21 nodes expanded to a million.
test('a copy fails at once when its source lists one node twice, however deep', () => {
  const chain = Array.from({ length: 40 }, (_, index) => ({ id: `n${index}`, label: 'X', children: [`n${index + 1}`, `n${index + 1}`] }));
  const nodes = [...chain, { id: 'n40', label: 'N', word: 'car' }, { id: 'k', label: 'K' }];
  const started = Date.now();
  const { issue } = expandPartsListAnalysis({ derivationStages: [stage(['k'], nodes), stage(['k'], [{ id: 'low', copyOf: 'n0' }])] });
  assert.ok(Date.now() - started < 1000, 'the copy is rejected without walking every repetition');
  assert.match(issue.message, /lists "n40" more than once/);
});

// Codex review on #340: a copy reaching a node that another copy of its stage
// names (c/n) read it before or after it existed, depending on entry order.
// Now it fails the same way in both orders; copying the copy itself works.
test('a copy may reach another copy of its stage only through that copy, in any entry order', () => {
  const run = (copies, p = ['c/n']) => expandPartsListAnalysis({ derivationStages: [
    stage(['q'], [{ id: 'n', label: 'N', word: 'car' }, { children: ['n'], id: 'q', label: 'Q' }]),
    stage(['q', 'z'], [...copies, { children: p, id: 'p', label: 'P' }])
  ] });
  const z = { id: 'z', copyOf: 'p' };
  const c = { id: 'c', copyOf: 'q' };
  for (const copies of [[z, c], [c, z]]) {
    assert.match(run(copies).issue?.message, /reaches "c\/n", which the copy "c" in this stage also names; copy "c" itself instead/);
    const { analysis, issue } = run(copies, ['c']);
    assert.equal(issue, undefined, issue?.message);
    const copied = analysis.derivationStages[1].workspaceForest[1];
    assert.deepEqual([copied.id, copied.children[0].id, copied.children[0].children[0].id], ['z', 'z/c', 'z/c/n']);
  }
});

// Codex review on #340 (758115a): an authored id that merely starts with a
// copy's id is not that copy's descendant.
test('a copy of an authored node whose id starts with the copy\'s id is an ordinary copy', () => {
  const { analysis, issue } = expandPartsListAnalysis({ derivationStages: [
    stage(['a/n'], [{ id: 'a/n', label: 'N', word: 'cat' }]),
    stage(['a/n', 'a'], [{ id: 'a', copyOf: 'a/n', silent: true }])
  ] });
  assert.equal(issue, undefined, issue?.message);
  assert.deepEqual(analysis.derivationStages[1].workspaceForest[1], { id: 'a', label: 'N', word: 'cat', silent: true, children: [] });
});

// Codex review on #340 (758115a): two copies naming the same descendant let
// the later one overwrite the other's word, depending on entry order.
test('two copies that would name the same descendant fail, in any entry order', () => {
  const run = (copies) => expandPartsListAnalysis({ derivationStages: [
    stage(['a', 'b'], [{ id: 'y', label: 'N', word: 'dog' }, { id: 'x/y', label: 'N', word: 'cat' },
      { children: ['x/y'], id: 'a', label: 'A' }, { children: ['y'], id: 'b', label: 'B' }]),
    stage(['c'], copies)
  ] });
  const c = { id: 'c', copyOf: 'a' };
  const cx = { id: 'c/x', copyOf: 'b' };
  assert.match(run([c, cx]).issue?.message, /the copies "c" and "c\/x" would both name a descendant "c\/x\/y"/);
  assert.match(run([cx, c]).issue?.message, /the copies "c\/x" and "c" would both name a descendant "c\/x\/y"/);
});

// Codex review on #340 (758115a): a 4,000-node source overflowed the stack
// before the depth limit was checked.
test('a copy of a very deep source is reported as too deep, not by a crash', () => {
  const chain = Array.from({ length: 4000 }, (_, index) => ({ id: `d${index}`, label: 'X', children: index < 3999 ? [`d${index + 1}`] : [] }));
  const { issue } = expandPartsListAnalysis({ derivationStages: [stage(['k'], [...chain, { id: 'k', copyOf: 'd0' }])] });
  assert.equal(issue?.stageIndex, 0);
  assert.match(issue?.message, /the subtree copied from "d0" nests deeper than 256 levels/);
});

// Sol review on #340 (284f669): a copy's generated descendant id replaced an
// unrelated node of an earlier stage, so q's child silently became "cat".
test('a copy may not rename a node an earlier stage defined for something else', () => {
  const earlier = stage(['q', 'p'], [{ id: 'low/n', label: 'N', word: 'dog' }, { children: ['low/n'], id: 'q', label: 'Q' },
    { id: 'n', label: 'N', word: 'cat' }, { children: ['n'], id: 'p', label: 'P' }]);
  const { issue } = expandPartsListAnalysis({ derivationStages: [earlier, stage(['q', 'p', 'low'], [{ id: 'low', copyOf: 'p' }])] });
  assert.match(issue?.message, /would name a descendant "low\/n", which already names another node, defined in stage 1/);
  // The same copy written again in a later stage keeps naming its own descendants.
  const recopied = expandPartsListAnalysis({ derivationStages: [
    stage(['p'], [{ id: 'n', label: 'N', word: 'cat' }, { children: ['n'], id: 'p', label: 'P' }]),
    stage(['p', 'low'], [{ id: 'low', copyOf: 'p' }]),
    stage(['p', 'low'], [{ id: 'n', label: 'N', word: 'cat', silent: true }, { id: 'low', copyOf: 'p' }])
  ] });
  assert.equal(recopied.issue, undefined, recopied.issue?.message);
  assert.equal(recopied.analysis.derivationStages[2].workspaceForest[1].children[0].silent, true);
});

// Sol review on #340 (284f669): a copy entry dropped fields such as
// tokenIndex that an ordinary node would have had checked.
test('a copy entry carries only id, copyOf, label, word, silent and lineageId', () => {
  const base = [{ id: 'n', label: 'N', word: 'car' }];
  for (const field of ['tokenIndex', 'surfaceSpan', 'mystery']) {
    const { issue } = expandPartsListAnalysis({ derivationStages: [stage(['n'], base), stage(['n', 'low'], [{ id: 'low', copyOf: 'n', [field]: 999 }])] });
    assert.match(issue?.message, new RegExp(`nodes\\[0\\]\\.${field}: expected no ${field}; a copy entry has only id, copyOf, label, word, silent and lineageId`));
  }
});
