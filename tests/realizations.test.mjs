import assert from 'node:assert/strict';
import test from 'node:test';
import { __test__ } from '../server/babelParser.js';
import { createTreeBankBundleSnapshot, loadTreeBankBundleSnapshot } from '../treeBankSnapshot.js';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { runQualificationAttempt } from '../contractQualification/run.js';

const leaf = (id, word, fields = {}) => ({ id, label: id, children: [], ...(word === undefined ? {} : { word }), ...fields });
const root = (children, fields = {}) => ({ id: 'phrase', label: 'VP', children, ...fields });
const stage = (tree, realizations, relations = []) => ({
  statement: 'The authored realization holds.', stageRecord: 'These syntax objects realize the supplied input.',
  relations, workspaceForest: [tree], ...(realizations === undefined ? {} : { realizations })
});
const group = (nodeIds, tokenIndices) => ({ nodeIds, tokenIndices });
const normalize = (stages, sentence, framework = 'minimalism') =>
  __test__.normalizeParseBundle({ derivationStages: stages }, framework, sentence, 'grok', true);
const nodes = (tree) => [tree, ...(tree.children || []).flatMap(nodes)];

test('collective realizations preserve morphology, ordinary indices and all saved/replayed stage state in both frameworks', () => {
  for (const framework of ['xbar', 'minimalism']) {
    const tree = root([leaf('subject', 'Mia', { tokenIndex: 0 }), leaf('root', 'walk'), leaf('past', '-ed')]);
    const groups = [group(['root', 'past'], [1])];
    const stages = [stage(tree), stage({ refId: 'phrase' }, groups, [{
      relation: 'Authored realization', anchors: { participants: ['root', 'past'] }, values: { form: 'walked' }
    }])];
    const original = structuredClone(stages);
    const bundle = normalize(stages, 'Mia walked', framework);
    const analysis = bundle.analyses[0];
    assert.deepEqual(nodes(analysis.tree).filter((node) => node.word).map(({ word }) => word), ['Mia', 'walk', '-ed']);
    assert.deepEqual(nodes(analysis.tree).filter((node) => 'tokenIndex' in node).map(({ id, tokenIndex }) => [id, tokenIndex]), [['subject', 0]]);
    assert.deepEqual(analysis.tree.surfaceSpan, [0, 1]);
    assert.deepEqual(analysis.derivationStages[1].realizations, groups);
    assert.ok(prepareReplay({ derivationStages: analysis.derivationStages, sentence: 'Mia walked', includePlayback: true }).playbackSteps.length > 0);
    assert.deepEqual(loadTreeBankBundleSnapshot(createTreeBankBundleSnapshot(bundle)), JSON.parse(JSON.stringify(bundle)));
    assert.deepEqual(stages, original);
    assert.deepEqual(__test__.inspectDerivationWorkspaces(stages, { sentence: 'Mia walked' }).flatMap(({ diagnostics }) => diagnostics), []);
  }
});

test('explicit groups support irregular, phrasal, repeated, separated and shared-source associations', () => {
  const cases = [
    ['went', root([leaf('root'), leaf('past')]), [group(['root', 'past'], [0])]],
    ['has walked', root([leaf('complex', 'walk')]), [group(['complex'], [0, 1])]],
    ['walked', root([root([leaf('root', 'walk'), leaf('past', '-ed')], { id: 'domain' })]), [group(['domain'], [0])]],
    ['had had', root([leaf('first', 'have'), leaf('second', 'have')]), [group(['first'], [0]), group(['second'], [1])]],
    ['a middle b', root([leaf('pair', 'pieces'), leaf('middle', 'middle')]), [group(['pair'], [0, 2])]],
    ['dogs cats', root([leaf('dogs', 'dog'), leaf('cats', 'cat'), leaf('plural')]),
      [group(['dogs', 'plural'], [0]), group(['cats', 'plural'], [1])]],
    ['walked', root([leaf('word', 'walked', { tokenIndex: 0 }), leaf('past')]), [group(['word', 'past'], [0])]]
  ];
  for (const [sentence, tree, groups] of cases) {
    const result = normalize([stage(tree, groups)], sentence).analyses[0];
    assert.deepEqual(result.derivationStages[0].realizations, groups, sentence);
    assert.deepEqual(__test__.inspectDerivationWorkspaces([stage(tree, groups)], { sentence })[0].diagnostics, [], sentence);
    if (sentence === 'a middle b') {
      assert.equal(nodes(result.tree).find(({ id }) => id === 'pair').surfaceSpan, undefined);
      assert.equal(nodes(result.tree).find(({ id }) => id === 'middle').tokenIndex, 1);
    }
  }
});

test('realizations cannot bypass whole-phrase silence or hide additional pronounced material', () => {
  const invalid = [
    [root([leaf('root', 'walk'), leaf('past', '-ed')], { silent: true }), [group(['root', 'past'], [0])], 'DERIVATION_REALIZATION_SILENT'],
    [root([root([leaf('root', 'walk')], { id: 'silent-domain', silent: true })]), [group(['silent-domain'], [0])], 'DERIVATION_REALIZATION_SILENT'],
    [root([leaf('root', 'walk'), leaf('extra', 'again')]), [group(['root'], [0])], 'DERIVATION_REALIZATION_COVERAGE']
  ];
  for (const [tree, groups, ruleId] of invalid) {
    assert.throws(() => normalize([stage(tree, groups)], 'walked'), (error) => error.failure.ruleId === ruleId);
  }
  const tree = root([leaf('root', 'walk'), leaf('past', '-ed'), leaf('lower', 'walk', { silent: true })]);
  assert.deepEqual(normalize([stage(tree, [group(['phrase'], [0])])], 'walked').analyses[0].tree.children[2], tree.children[2]);
});

test('precise diagnostics preserve invalid group shape, references, indices and conflicts', () => {
  const cases = [
    [null, {}, '.realizations', 'DERIVATION_REALIZATION_SHAPE'],
    [[{ nodeIds: ['root'], tokenIndices: [0], form: 'walked' }], {}, '.realizations[0]', 'DERIVATION_REALIZATION_SHAPE'],
    [[group(['root', 'root'], [0])], {}, '.realizations[0].nodeIds[1]', 'DERIVATION_REALIZATION_SHAPE'],
    [[group(['missing'], [0])], {}, '.realizations[0].nodeIds[0]', 'DERIVATION_REALIZATION_SOURCE'],
    [[group(['root'], [1])], {}, '.realizations[0].tokenIndices[0]', 'DERIVATION_REALIZATION_TOKEN'],
    [[group(['root'], [0]), group(['past'], [0])], {}, '.realizations[1].tokenIndices[0]', 'DERIVATION_REALIZATION_TOKEN'],
    [[group(['root', 'past'], [0])], { tokenIndex: 0 }, '.workspaceForest[0].children[0].tokenIndex', 'DERIVATION_REALIZATION_DIRECT_INDEX']
  ];
  for (const [groups, fields, suffix, ruleId] of cases) {
    const stages = [stage(root([leaf('root', 'walk', fields), leaf('past', '-ed')]), groups)];
    const original = structuredClone(stages);
    assert.throws(() => normalize(stages, 'walked'), (error) => {
      assert.equal(error.failure.ruleId, ruleId);
      assert.equal(error.failure.fieldPath, `$.derivationStages[0]${suffix}`);
      return true;
    });
    const inspected = __test__.inspectDerivationWorkspaces(stages, { sentence: 'walked', analysisIndex: 2, fieldPath: '$.analyses[2]' });
    assert.ok(inspected[0].diagnostics.some((issue) => issue.ruleId === ruleId && issue.fieldPath === `$.analyses[2].derivationStages[0]${suffix}`));
    assert.deepEqual(inspected[0].authoredStage, original[0]);
    assert.deepEqual(stages, original);
  }
});

test('groups are current-stage state; omission neither inherits earlier groups nor relaxes ordinary matching', () => {
  const tree = root([leaf('root', 'walk'), leaf('past', '-ed')]);
  assert.throws(() => normalize([stage(tree, [group(['root', 'past'], [0])]), stage({ refId: 'phrase' })], 'walked'),
    (error) => error.failure.ruleId === 'SURFACE_ORDER_EXACT');
  const plain = leaf('word', 'walked');
  assert.deepEqual(normalize([stage(plain, [])], 'walked').analyses[0].tree, normalize([stage(plain)], 'walked').analyses[0].tree);
  const earlier = leaf('word', 'walk', { tokenIndex: 0 });
  assert.deepEqual(normalize([stage(earlier, []), stage(plain)], 'walked').analyses[0].tree,
    normalize([stage(earlier), stage(plain)], 'walked').analyses[0].tree);
  const partial = [stage(tree, [group(['root', 'past'], [1])]), stage(root([leaf('subject', 'Mia'), tree], { id: 'final' }), [group(['root', 'past'], [1])])];
  assert.equal(normalize(partial, 'Mia walked').analyses.length, 1);
});

test('collective coverage does not mistake an unresolved final forest for mismatching input', () => {
  const split = { ...stage(leaf('root', 'walk'), [group(['root', 'past'], [0])]),
    workspaceForest: [leaf('root', 'walk'), leaf('past', '-ed')] };
  assert.throws(() => normalize([split], 'walked'), (error) => error.code === 'INCOMPLETE_GENERATION');
  assert.deepEqual(__test__.inspectDerivationWorkspaces([split], { sentence: 'walked' })[0].diagnostics.map(({ ruleId }) => ruleId),
    ['DERIVATION_FINAL_WORKSPACE_MULTIPLE_ROOTS']);
});

test('realization membership and assignments use exact authored IDs, including spaces', () => {
  const tree = root([leaf(' whole ', 'Mia'), leaf(' stem ', 'walk'), leaf(' past ', '-ed')]);
  const groups = [group([' stem ', ' past '], [1])];
  const result = normalize([stage(tree, groups)], 'Mia walked').analyses[0];
  assert.equal(result.tree.children[0].id, ' whole ');
  assert.equal(result.tree.children[0].tokenIndex, 0);
  assert.deepEqual(result.derivationStages[0].realizations, groups);
  assert.throws(() => normalize([stage(tree, [group(['stem', ' past '], [1])])], 'Mia walked'),
    (error) => error.failure.ruleId === 'DERIVATION_REALIZATION_SOURCE');
});

test('inspection retains exact input, raw groups and missing ownership without putting diagnostics in Replay prose', () => {
  const tree = root([leaf('root', 'walk'), leaf('past', '-ed')]);
  const stages = [stage(tree), stage({ refId: 'phrase' }, [group(['root', 'past'], [0])])];
  const attempt = { id: 'realization-inspection', request: { sentence: 'walked', framework: 'minimalism' },
    model: { providerRoute: 'grok', providerModel: 'fixture', nativeSettings: {} }, source: { kind: 'raw-text-file', path: 'in-memory' } };
  const outcome = runQualificationAttempt({ attempt, rawOutputBytes: Buffer.from(JSON.stringify({ derivationStages: stages })) });
  assert.ok(outcome.bundle);
  assert.deepEqual(outcome.inspection.input, { sentence: 'walked', tokens: ['walked'] });
  assert.deepEqual(outcome.inspection.analyses[0].stages[1].authoredStage, stages[1]);
  assert.match(outcome.inspection.analyses[0].realizationReplayDiagnostics.join('\n'), /REALIZATION_MISSING_OWNER/);
  const malformed = structuredClone(stages);
  malformed[1].realizations[0].tokenIndices = [1];
  const failed = runQualificationAttempt({ attempt, rawOutputBytes: Buffer.from(JSON.stringify({ derivationStages: malformed })) });
  assert.equal(failed.bundle, null);
  assert.deepEqual(failed.inspection.input, outcome.inspection.input);
  assert.deepEqual(failed.inspection.analyses[0].stages[1].authoredStage, malformed[1]);
});
