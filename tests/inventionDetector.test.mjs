import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildDerivationReplayPlan } from '../derivationReplayPlan.js';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
import {
  __TEST_ONLY__,
  adaptDerivationStagesForReplay,
  buildAuthoredRelationLinksForFrames
} from '../replay/replayCompiler.ts';
import { __test__ } from '../server/babelParser.js';
import {
  assertNoDeterministicLinguisticInvention,
  detectDeterministicLinguisticInvention
} from '../server/babelParser/inventionDetector.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawFixtureDir = path.join(repoRoot, 'fixtures', 'raw');
const clone = (value) => structuredClone(value);

const normalize = (payload, sentence) => __test__.normalizeParseBundle(
  payload,
  'xbar',
  sentence,
  'fixture',
  true,
  { payloadIntegrityFlags: [] }
);

const buildSingleStagePayload = (workspaceForest, statement = 'The authored structure converges.') => ({
  derivationStages: [{
    statement,
    stageRecord: 'The authored workspace is the complete provider-free syntactic evidence for this convergent stage.',
    relations: [],
    workspaceForest
  }]
});

const buildRenderedRelationLinks = (analysis, replayPlan) => {
  const frames = adaptDerivationStagesForReplay(analysis.derivationStages);
  const activeFrameIndex = frames.length - 1;
  const forest = activeFrameIndex >= 0
    ? frames[activeFrameIndex].workspaceForest
    : [];
  return buildAuthoredRelationLinksForFrames(
    frames,
    replayPlan,
    activeFrameIndex,
    forest
  );
};

test('permanent invention detector accepts every provider-free fixture projection', () => {
  const fixtureNames = fs.readdirSync(rawFixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  for (const fixtureName of fixtureNames) {
    const fixture = JSON.parse(
      fs.readFileSync(path.join(rawFixtureDir, fixtureName), 'utf8')
    );
    const bundle = normalize(clone(fixture.payload), fixture.sentence);
    const analysis = bundle.analyses[0];
    const replayPlan = buildDerivationReplayPlan({
      derivationStages: analysis.derivationStages
    });
    const renderedRelationLinks = buildRenderedRelationLinks(
      analysis,
      replayPlan
    );
    const renderableRelationCount = replayPlan.steps.filter((step) => (
      step.kind === 'relation'
      && Array.isArray(step.resolvedAnchors)
      && step.resolvedAnchors.length > 0
    )).length;
    assert.equal(renderedRelationLinks.length, renderableRelationCount);
    const replaySnapshot = buildReplayPlayback(bundle);
    assert.doesNotThrow(() => assertNoDeterministicLinguisticInvention({
      authoredDerivationStages: fixture.payload.derivationStages,
      analysis,
      replayPlan,
      replaySnapshot,
      renderedRelationLinks
    }), fixtureName);
  }
});

test('detector discriminates invented IDs, scalar rewrites, and operation labels', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(rawFixtureDir, 'mia-laughed.xbar.json'), 'utf8')
  );
  const analysis = normalize(clone(fixture.payload), fixture.sentence).analyses[0];
  analysis.tree.children[0].id = 'invented-node';
  analysis.derivationStages[0].workspaceForest[0].label = 'InventedProjection';
  const replayPlan = buildDerivationReplayPlan({
    derivationStages: analysis.derivationStages
  });
  replayPlan.steps[0].operation = 'InventedReplayOperation';

  const kinds = new Set(detectDeterministicLinguisticInvention({
    authoredDerivationStages: fixture.payload.derivationStages,
    analysis,
    replayPlan
  }).map((issue) => issue.kind));
  assert.equal(kinds.has('compiled-node-id-not-authored'), true);
  assert.equal(kinds.has('compiled-node-label-not-authored'), true);
  assert.equal(kinds.has('replay-plan-operation-not-authored-or-declared'), true);
});

test('the detector verifies bound role provenance and recovered movement endpoints', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(rawFixtureDir, 'what-did-mia-see.xbar.json'), 'utf8'));
  const movement = fixture.payload.derivationStages[3].relations[0];
  movement.anchors = { upperOccurrence: 'dp_what_high', basePosition: 'dp_what_low', departureWitness: 'what_low' };
  const analysis = normalize(clone(fixture.payload), fixture.sentence).analyses[0];
  const replayPlan = buildDerivationReplayPlan({ derivationStages: analysis.derivationStages });
  const renderedRelationLinks = buildRenderedRelationLinks(analysis, replayPlan);
  const input = { authoredDerivationStages: fixture.payload.derivationStages, analysis, replayPlan, renderedRelationLinks };
  assert.doesNotThrow(() => assertNoDeterministicLinguisticInvention(input));
  const link = renderedRelationLinks[0];
  assert.equal(link.endpointOrderProvenance, 'recovered-movement');
  const originalTarget = link.targetNodeId;
  link.targetNodeId = link.sourceNodeId;
  assert.ok(detectDeterministicLinguisticInvention(input).some(i => i.kind === 'displayed-relation-endpoint-order-mismatch'));
  link.targetNodeId = originalTarget;
  link.anchors[0].role = 'inventedRole';
  assert.ok(detectDeterministicLinguisticInvention(input).some(i => i.kind === 'displayed-relation-anchor-set-mismatch'));
});

test('proved Tier 3 movement endpoints do not authorize a trajectory', () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(rawFixtureDir, 'what-did-mia-see.xbar.json'), 'utf8'));
  fixture.payload.derivationStages[3].relations[0] = {
    relation: 'AbarMove', anchors: { landing: 'dp_what_high', source: 'dp_what_low' }
  };
  const analysis = normalize(clone(fixture.payload), fixture.sentence).analyses[0];
  const replayPlan = buildDerivationReplayPlan({ derivationStages: analysis.derivationStages });
  const renderedRelationLinks = buildRenderedRelationLinks(analysis, replayPlan);
  const input = { authoredDerivationStages: fixture.payload.derivationStages, analysis, replayPlan, renderedRelationLinks };
  const link = renderedRelationLinks.find(link => link.relation === 'AbarMove');
  assert.equal(link.endpointOrderProvenance, 'recovered-movement');
  assert.equal(link.renderFamily, 'authored-anchor-link');
  assert.doesNotThrow(() => assertNoDeterministicLinguisticInvention(input));
  const target = link.targetNodeId;
  link.targetNodeId = link.sourceNodeId;
  assert.ok(detectDeterministicLinguisticInvention(input).some(issue => issue.kind === 'displayed-relation-endpoint-order-mismatch'));
  link.targetNodeId = target;
  link.renderFamily = 'trajectory';
  link.trajectoryKind = 'phrasal';
  assert.ok(detectDeterministicLinguisticInvention(input).some(issue => issue.kind === 'displayed-movement-trajectory-not-licensed'));
});

test('compiler leaves bare authored structural heads bare instead of inventing null exponents', () => {
  const payload = buildSingleStagePayload([{
    id: 'tp',
    label: 'TP',
    children: [
      { id: 't', label: 'T', children: [] },
      { id: 'mia', label: 'Mia', word: 'Mia', tokenIndex: 0, children: [] }
    ]
  }]);
  const analysis = normalize(payload, 'Mia').analyses[0];
  const head = analysis.tree.children[0];
  assert.equal(head.id, 't');
  assert.equal(head.label, 'T');
  assert.deepEqual(head.children, []);
});

test('compiler preserves authored movement-index labels', () => {
  const payload = buildSingleStagePayload([{
    id: 'dp',
    label: 'DP₁',
    children: [{
      id: 'what',
      label: 'What₁',
      word: 'What',
      tokenIndex: 0,
      children: []
    }]
  }]);
  const analysis = normalize(payload, 'What').analyses[0];
  assert.equal(analysis.tree.label, 'DP₁');
  assert.equal(analysis.tree.children[0].label, 'What₁');
});

test('compiler derives alignment metadata without rewriting authored linguistic scalars', () => {
  const payload = buildSingleStagePayload([{
    id: 'mia',
    label: 'Name',
    word: 'MIA',
    children: []
  }]);
  const analysis = normalize(payload, 'Mia').analyses[0];
  assert.equal(analysis.tree.label, 'Name');
  assert.equal(analysis.tree.word, 'MIA');
  assert.equal(analysis.tree.tokenIndex, 0);
  assert.deepEqual(analysis.tree.surfaceSpan, [0, 0]);
});

test('compiler rejects authored alignment metadata that would require repair', () => {
  const payload = buildSingleStagePayload([{
    id: 'mia',
    label: 'Mia',
    word: 'Mia',
    tokenIndex: 1,
    surfaceSpan: [1, 1],
    children: []
  }]);
  const original = clone(payload);
  assert.throws(
    () => normalize(payload, 'Mia'),
    (error) => {
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.equal(error.failure.ruleId, 'DERIVATION_TOKEN_ALIGNMENT');
      assert.equal(error.failure.processingStep, 'token-alignment');
      assert.equal(error.failure.fieldPath, '$.derivationStages[0].workspaceForest[0].tokenIndex');
      assert.equal(error.failure.offendingValue, 1);
      assert.equal(error.failure.expectedForm, 'the integer 0');
      return true;
    }
  );
  assert.deepEqual(payload, original);
});

test('compiler rejects a bare structural label instead of promoting it into sentence material', () => {
  const payload = buildSingleStagePayload([{
    id: 'n',
    label: 'N',
    children: []
  }]);
  assert.throws(
    () => normalize(payload, 'N'),
    (error) => error?.code === 'BAD_MODEL_RESPONSE'
  );
});

test('compiler rejects duplicate active authored node IDs instead of removing roots', () => {
  const shared = {
    id: 'mia',
    label: 'Mia',
    word: 'Mia',
    tokenIndex: 0,
    children: []
  };
  const payload = buildSingleStagePayload([
    shared,
    {
      id: 'tp',
      label: 'TP',
      children: [clone(shared)]
    }
  ]);
  assert.throws(
    () => normalize(payload, 'Mia'),
    /duplicate active node id mia/
  );
});

test('compiler rejects anchor-value aliases instead of silently rewriting them', () => {
  const payload = buildSingleStagePayload([{
    id: 'mia',
    label: 'Mia',
    word: 'Mia',
    tokenIndex: 0,
    children: []
  }]);
  payload.derivationStages[0].relations = [{
    relation: 'authored-relation',
    anchors: {
      witness: { nodeId: 'mia' }
    }
  }];
  assert.throws(
    () => normalize(payload, 'Mia'),
    (error) => error?.code === 'BAD_MODEL_RESPONSE'
  );
});

test('renderer expands authored lexical preterminals but never materializes an unauthored null', () => {
  const bareHead = { id: 't', label: 'T', children: [] };
  assert.deepEqual(__TEST_ONLY__.materializeReplayPreterminals(bareHead), bareHead);

  const overtHead = {
    id: 'v',
    label: 'V',
    word: 'laughed',
    children: []
  };
  const rendered = __TEST_ONLY__.materializeReplayPreterminals(overtHead);
  assert.equal(rendered.label, 'V');
  assert.equal(rendered.children[0].label, 'laughed');
  assert.equal(rendered.children[0].id, 'v::__leaf');
});

test('render plan keeps bare relation endpoints authored without null or trace synthesis', () => {
  const payload = buildSingleStagePayload([{
    id: 'cp',
    label: 'CP',
    children: [
      { id: 'c', label: 'C', children: [] },
      {
        id: 'tp',
        label: 'TP',
        children: [
          { id: 't', label: 'T', children: [] },
          { id: 'mia', label: 'Mia', word: 'Mia', tokenIndex: 0, children: [] }
        ]
      }
    ]
  }], 'The authored head relation converges.');
  payload.derivationStages[0].relations = [{
    relation: 'head-movement',
    anchors: { source: 't', landing: 'c' }
  }];

  const bundle = normalize(payload, 'Mia');
  const analysis = bundle.analyses[0];
  const [authoredRelation] = analysis.derivationStages[0].relations;
  assert.deepEqual(
    authoredRelation,
    { relation: 'head-movement', anchors: { source: 't', landing: 'c' } }
  );
  const replayPlan = buildDerivationReplayPlan({
    derivationStages: analysis.derivationStages
  });
  assert.equal(replayPlan.stages[0].relationSteps[0].targetNodeId, undefined);
  assert.deepEqual(
    replayPlan.stages[0].relationSteps[0].resolvedAnchors
      .map(({ role, nodeId }) => ({ role, nodeId })),
    [
      { role: 'source', nodeId: 't' },
      { role: 'landing', nodeId: 'c' }
    ]
  );
  const renderedRelationLinks = buildRenderedRelationLinks(
    analysis,
    replayPlan
  );
  assert.equal(renderedRelationLinks.length, 1);
  assert.deepEqual(
    renderedRelationLinks[0].anchors,
    [
      { role: 'source', nodeId: 't' },
      { role: 'landing', nodeId: 'c' }
    ]
  );
  assert.equal(
    renderedRelationLinks[0].endpointOrderProvenance,
    'authored-anchor-order'
  );
  const replaySnapshot = buildReplayPlayback(bundle);
  const serialized = JSON.stringify(replaySnapshot);
  assert.equal(serialized.includes('::__null'), false);
  assert.equal(serialized.includes('__shell'), false);
  assert.doesNotThrow(() => assertNoDeterministicLinguisticInvention({
    authoredDerivationStages: payload.derivationStages,
    analysis,
    replayPlan,
    replaySnapshot,
    renderedRelationLinks
  }));
});

test('detector rejects suppression of renderable authored relation evidence', () => {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(rawFixtureDir, 'mia-laughed.xbar.json'), 'utf8')
  );
  const analysis = normalize(clone(fixture.payload), fixture.sentence).analyses[0];
  const replayPlan = buildDerivationReplayPlan({
    derivationStages: analysis.derivationStages
  });
  const renderedRelationLinks = buildRenderedRelationLinks(
    analysis,
    replayPlan
  );
  assert.ok(renderedRelationLinks.length > 0);

  const kinds = new Set(detectDeterministicLinguisticInvention({
    authoredDerivationStages: fixture.payload.derivationStages,
    analysis,
    replayPlan,
    renderedRelationLinks: []
  }).map((issue) => issue.kind));
  assert.equal(
    kinds.has('authored-renderable-relation-not-displayed'),
    true
  );
});


test('detector uses exact authored IDs and display provenance instead of suffix spelling', () => {
  const authoredDerivationStages = buildSingleStagePayload([{
    id: ' root ', label: 'VP', children: [
      { id: ' a ', label: 'V', word: 'read', children: [] },
      { id: ' a ::__leaf', label: 'N', word: 'books', children: [] }
    ]
  }]).derivationStages;
  const replaySnapshot = buildReplayPlayback({ sentence: 'read books', analyses: [{ derivationStages: authoredDerivationStages }] });
  const input = { authoredDerivationStages, replaySnapshot };
  assert.doesNotThrow(() => assertNoDeterministicLinguisticInvention(input));
  const step = replaySnapshot.steps.at(-1);
  step.replayVisibleNodeIds.push(' a ::__lex_forged');
  assert(detectDeterministicLinguisticInvention(input).some(issue => issue.kind === 'replay-node-id-not-authored-or-declared-preterminal' && issue.nodeId === ' a ::__lex_forged'));
});
