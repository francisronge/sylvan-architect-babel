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
