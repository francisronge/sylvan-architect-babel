import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { normalizeParseBundle } from '../server/babelParser/parseNormalization.js';
import { inspectDerivationWorkspaces } from '../server/babelParser/derivationCompiler.js';
import { resolveSavedInputTokens } from '../server/babelParser/surfaceTokens.js';
import { convertSpelloutPayload } from '../server/babelParser/spellout.js';
import { expandPartsListAnalysis, workspaceFormOf } from '../server/babelParser/partsList.js';
import { buildSystemInstruction } from '../server/babelParser/systemInstruction.js';
import { buildReplaySnapshotProjection } from '../replay/replaySnapshot.ts';
import { restateAsSpellout } from './helpers/spelloutPayload.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

const normalize = (payload, sentence, framework = 'xbar', options = {}) =>
  normalizeParseBundle(structuredClone(payload), framework, sentence, 'gpt', true, { spellout: true, ...options });

/**
 * Restates a nested analysis as a parts list: each stage names its roots and
 * lists only the nodes whose own fields or child ids differ from their latest
 * earlier definition.
 */
const toPartsList = (analysis) => {
  const inspected = inspectDerivationWorkspaces(analysis.derivationStages);
  const latest = new Map();
  const derivationStages = analysis.derivationStages.map((stage, stageIndex) => {
    const forest = inspected[stageIndex].workspaceForest;
    assert.ok(forest, `stage ${stageIndex + 1} expands`);
    const nodes = [];
    const visit = (node) => {
      const { children, ...fields } = node;
      const entry = children.length ? { ...fields, children: children.map(child => child.id) } : fields;
      if (JSON.stringify(latest.get(node.id)) !== JSON.stringify(entry)) nodes.push(entry);
      latest.set(node.id, entry);
      children.forEach(visit);
    };
    forest.forEach(visit);
    const { workspaceForest: _forest, ...rest } = stage;
    const { realizations, ...fields } = rest;
    return { ...fields, workspace: forest.map(root => root.id), nodes, ...(realizations ? { realizations } : {}) };
  });
  return { ...analysis, derivationStages };
};

const fixtureRecords = () => {
  const records = [];
  const walk = (value, label) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${label}[${index}]`));
    if (typeof value.sentence === 'string' && (Array.isArray(value.derivationStages) || Array.isArray(value.analyses))) {
      records.push({ label, sentence: value.sentence, framework: value.framework === 'minimalism' ? 'minimalism' : 'xbar',
        inputTokens: value.inputTokens,
        payload: Array.isArray(value.analyses) ? { analyses: value.analyses } : { derivationStages: value.derivationStages } });
      return;
    }
    Object.entries(value).forEach(([key, item]) => walk(item, `${label}.${key}`));
  };
  const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(full);
    else if (entry.name.endsWith('.json')) walk(JSON.parse(fs.readFileSync(full, 'utf8')), path.relative(repoRoot, full));
  });
  visit(path.join(repoRoot, 'fixtures'));
  return records;
};

const derived = (bundle, sentence) => bundle.analyses.map(({ provenance, derivationStages, ...rest }) => ({
  rest, replay: buildReplaySnapshotProjection({ ...bundle, sentence, analyses: [{ provenance, derivationStages, ...rest }] })
}));

test('every fixture written as a parts list expands to the same workspaces, parse and Replay', (t) => {
  let compared = 0;
  for (const record of fixtureRecords()) {
    const tokens = resolveSavedInputTokens(record.sentence, record.inputTokens);
    let nested;
    try {
      nested = restateAsSpellout(record.payload, record.sentence, tokens);
      if (!convertSpelloutPayload(nested, record.sentence).every(result => result.ok)) continue;
    } catch { continue; }
    let baseline;
    try { baseline = normalize(nested, record.sentence, record.framework); } catch { continue; }
    const analyses = nested.analyses || [nested];
    const partsList = analyses.map(toPartsList);
    partsList.forEach((analysis, index) => {
      assert.equal(workspaceFormOf(analysis), 'parts-list', record.label);
      const expanded = expandPartsListAnalysis(analysis);
      assert.equal(expanded.issue, undefined, `${record.label}: ${expanded.issue?.message}`);
      const forests = stages => inspectDerivationWorkspaces(stages).map(entry => entry.workspaceForest);
      assert.deepEqual(forests(expanded.analysis.derivationStages), forests(analyses[index].derivationStages), record.label);
    });
    const payload = nested.analyses ? { analyses: partsList } : partsList[0];
    const candidate = normalize(payload, record.sentence, record.framework);
    assert.deepEqual(candidate.inputTokens, baseline.inputTokens, record.label);
    assert.deepEqual(derived(candidate, record.sentence), derived(baseline, record.sentence), record.label);
    compared += 1;
  }
  assert.ok(compared >= 80, `only ${compared} fixtures compared`);
  t.diagnostic(`${compared} fixtures compared`);
});

test('a parts list is shorter and shallower than the nested forest it replaces', () => {
  const record = fixtureRecords().find(item => item.label.includes('landing-claimed-again'));
  const nested = restateAsSpellout(record.payload, record.sentence, resolveSavedInputTokens(record.sentence, record.inputTokens));
  const partsList = toPartsList(nested);
  const depth = (value) => (value && typeof value === 'object' ? 1 + Math.max(0, ...Object.values(value).map(depth)) : 0);
  const trees = analysis => ({ derivationStages: analysis.derivationStages.map(({ nodes, workspaceForest }) => ({ nodes, workspaceForest })) });
  assert.ok(depth(trees(nested)) > 20, `nested trees are ${depth(trees(nested))} levels deep`);
  // Root, derivationStages, stage, nodes, node, children: the same for every tree.
  assert.equal(depth(trees(partsList)), 6);
});

const stage = (workspace, nodes, extra = {}) => ({
  statement: 'A stage.', stageRecord: 'Something happens.', relations: [], workspace, nodes, ...extra
});
const laughed = [
  stage(['v'], [{ id: 'v', label: 'V', word: 'laughed' }]),
  stage(['vp'], [{ id: 'n', label: 'N', word: 'Mia' }, { id: 'vp', label: 'VP', children: ['n', 'v'] }])
];
const failureOf = (derivationStages, options = {}) => {
  let caught;
  try { normalize({ derivationStages }, 'Mia laughed.', 'xbar', options); } catch (error) { caught = error; }
  assert.ok(caught, 'the analysis is rejected');
  return caught;
};

test('a parts list carries unchanged nodes forward and replaces redefined ones', () => {
  const bundle = normalize({ derivationStages: laughed }, 'Mia laughed.');
  assert.deepEqual(bundle.inputTokens, ['Mia', 'laughed']);
  const [{ workspaceForest }] = inspectDerivationWorkspaces(laughed).slice(-1);
  assert.deepEqual(workspaceForest, [{ id: 'vp', label: 'VP', children: [
    { id: 'n', label: 'N', word: 'Mia', children: [] }, { id: 'v', label: 'V', word: 'laughed', children: [] }] }]);
  // A redefinition replaces the earlier node wherever it is reached.
  const silenced = [...laughed, stage(['vp'], [{ id: 'v', label: 'V', word: 'laughed', silent: true }])];
  const final = inspectDerivationWorkspaces(silenced).at(-1).workspaceForest;
  assert.equal(final[0].children[1].silent, true);
});

test('a child id that no stage defines is reported where it is written', () => {
  const error = failureOf([laughed[0], stage(['vp'], [{ id: 'vp', label: 'VP', children: ['n', 'v'] }])]);
  assert.equal(error.failure.ruleId, 'DERIVATION_PARTS_LIST_VALID');
  assert.equal(error.failure.fieldPath, '$.derivationStages[1].nodes[0].children[0]');
  assert.match(error.message, /Stage 2, \$\.derivationStages\[1\]\.nodes\[0\]\.children\[0\]: no node "n" is defined in this or an earlier stage\./);
});

test('a node may stand at only one position', () => {
  const twoParents = failureOf([laughed[0], stage(['vp', 'x'], [
    { id: 'n', label: 'N', word: 'Mia' }, { id: 'vp', label: 'VP', children: ['n', 'v'] }, { id: 'x', label: 'X', children: ['v'] }])]);
  assert.equal(twoParents.failure.fieldPath, '$.derivationStages[1].nodes[2].children[0]');
  assert.match(twoParents.message, /node "v" stands at two positions in this workspace: under "vp" \(\$\.derivationStages\[1\]\.nodes\[1\]\.children\[1\]\) and under "x"/);
  const rootAndChild = failureOf([laughed[0], stage(['vp', 'v'], laughed[1].nodes)]);
  assert.match(rootAndChild.message, /node "v" stands at two positions in this workspace: under "vp" .* and as a root/);
});

test('a node may not contain itself', () => {
  const error = failureOf([stage(['a'], [{ id: 'a', label: 'A', children: ['b'] }, { id: 'b', label: 'B', children: ['a'] }])]);
  assert.equal(error.failure.fieldPath, '$.derivationStages[0].nodes[1].children[0]');
  assert.match(error.message, /node "a" contains itself through its children/);
});

test('one analysis may not mix parts-list and nested stages', () => {
  const nestedStage = { statement: 'A stage.', stageRecord: 'Something happens.', relations: [],
    workspaceForest: [{ id: 'v', label: 'V', word: 'laughed', children: [] }] };
  const error = failureOf([nestedStage, laughed[1]]);
  assert.equal(error.failure.ruleId, 'DERIVATION_WORKSPACE_FORM_MIXED');
  assert.equal(error.failure.fieldPath, '$.derivationStages[0].workspaceForest');
  // Separate analyses of one response may each use either form.
  const mixedResponse = { analyses: [{ derivationStages: laughed }, { derivationStages: [{ ...nestedStage,
    workspaceForest: [{ id: 's', label: 'S', children: [{ id: 'm', label: 'N', word: 'Mia', children: [] }, nestedStage.workspaceForest[0]] }] }] }] };
  assert.equal(normalize(mixedResponse, 'Mia laughed.').analyses.length, 2);
});

test('parts-list entries are checked field by field', () => {
  const cases = [
    [[stage(['v'], [{ id: 'v', label: 'V', word: 'laughed', children: [{ id: 'w', label: 'W', children: [] }] }])],
      '$.derivationStages[0].nodes[0].children[0]', /a node id; list the child as its own entry in nodes/],
    [[stage(['v'], [{ id: 'v', label: 'V', word: 'laughed' }, { id: 'v', label: 'V', word: 'laughed' }])],
      '$.derivationStages[0].nodes[1].id', /node "v" is listed more than once in this stage's nodes/],
    [[stage(['v'], [{ refId: 'v' }])], '$.derivationStages[0].nodes[0].refId', /no refId/],
    [[stage(['v'], [{ id: 'v', label: '', word: 'laughed' }])], '$.derivationStages[0].nodes[0].label', /a nonblank string/],
    [[stage(['v'], [{ id: 'v', label: 'V', silent: 'yes' }])], '$.derivationStages[0].nodes[0].silent', /a boolean/],
    [[{ ...stage(['v'], [{ id: 'v', label: 'V', word: 'laughed' }]), extra: 1 }], '$.derivationStages[0]', /workspace and nodes, with only realizations optional/],
    [[{ statement: 'A stage.', stageRecord: 'Something.', relations: [], workspace: ['v'] }], '$.derivationStages[0]', /received the fields statement, stageRecord, relations, workspace/]
  ];
  for (const [stages, fieldPath, message] of cases) {
    const error = failureOf(stages);
    assert.equal(error.failure.fieldPath, fieldPath, error.message);
    assert.match(error.message, message);
  }
});

test('a failing analysis of several is reported with its analysis path and outcome', () => {
  const outcomes = [];
  let caught;
  try {
    normalize({ analyses: [{ derivationStages: laughed }, { derivationStages: [laughed[0], stage(['vp'], [{ id: 'vp', label: 'VP', children: ['n', 'v'] }])] }] },
      'Mia laughed.', 'xbar', { analysisOutcomes: outcomes });
  } catch (error) { caught = error; }
  assert.equal(caught.failure.fieldPath, '$.analyses[1].derivationStages[1].nodes[0].children[0]');
  assert.match(caught.message, /^Analysis 2: Stage 2, \$\.analyses\[1\]\.derivationStages\[1\]/);
  assert.deepEqual(outcomes.map(outcome => [outcome.analysisIndex, outcome.status]), [[1, 'failed']]);
});

test('inspection shows the expanded stages before a parts-list defect and blocks the rest', () => {
  const stages = [laughed[0], stage(['vp'], [{ id: 'vp', label: 'VP', children: ['n', 'v'] }]), laughed[1]];
  const inspected = inspectDerivationWorkspaces(stages);
  assert.deepEqual(inspected[0].workspaceForest, [{ id: 'v', label: 'V', word: 'laughed', children: [] }]);
  assert.equal(inspected[1].workspaceForest, null);
  assert.equal(inspected[1].diagnostics[0].ruleId, 'DERIVATION_PARTS_LIST_VALID');
  assert.equal(inspected[1].authoredStage.nodes[0].id, 'vp');
  assert.equal(inspected[2].transitionUnavailableSinceStageIndex, 1);
  assert.deepEqual(inspected.map(entry => entry.diagnostics.length > 0), [false, true, false]);
});

test('nested analyses are read exactly as before', () => {
  const nested = { derivationStages: [{ statement: 'A stage.', stageRecord: 'Something happens.', relations: [],
    workspaceForest: [{ id: 'vp', label: 'VP', children: [{ id: 'n', label: 'N', word: 'Mia', children: [] }, { id: 'v', label: 'V', word: 'laughed', children: [] }] }] }] };
  const result = expandPartsListAnalysis(nested);
  assert.equal(result.form, 'nested');
  assert.equal(result.analysis, nested);
});

test('the prompt asks for a parts list and no longer mentions refId or nested forests', () => {
  for (const framework of ['xbar', 'minimalism']) {
    const instruction = buildSystemInstruction(framework);
    assert.doesNotMatch(instruction, /refId|workspaceForest|expanded workspace|expanding/);
    assert.match(instruction, /- workspace: an array of node ids naming the root of every currently active syntax tree/);
    assert.match(instruction, /- nodes: an array of the syntax nodes this stage introduces or changes/);
    assert.match(instruction, /- children: an ordered array of node ids, the node's daughters from left to right\./);
    assert.match(instruction, /Each id stands at only one position in the workspace: it is one root or the child of one parent, and never beneath itself\./);
  }
});
