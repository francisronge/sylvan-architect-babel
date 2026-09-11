import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { __test__, ParseApiError } from '../server/babelParser.js';
import { createParseRoutes } from '../server/babelParser/parseRoutes.js';
import { formatApiError } from '../server/parseApi.js';
import { runQualificationAttempt } from '../contractQualification/run.js';

const node = (id) => ({ id, label: 'N', word: 'Mia', tokenIndex: 0, children: [] });
const stage = (workspaceForest, relations = []) => ({
  statement: 'An authored state.',
  stageRecord: 'The current workspace contains the nominal occurrence.',
  relations,
  workspaceForest
});
const relation = (id, values) => ({ relation: 'Authored relation', anchors: { witness: id }, values });
const normalize = (payload) => __test__.normalizeParseBundle(payload, 'xbar', 'Mia', 'claude', true);
const attempt = {
  id: 'diagnostic-regression',
  request: { sentence: 'Mia', framework: 'xbar' },
  model: { providerRoute: 'claude', providerModel: 'fixture', nativeSettings: {} },
  source: { kind: 'raw-text-file', path: 'in-memory-regression' }
};

// Reduced reproductions of the two saved Fable failures, not linguistic fixtures.
const fableCases = [
  { name: 'Minimalism', brokenIndex: 2, relationIndex: 0, sourceId: 'd_john_hi', values: ['phi', 'Nom'], missingClosers: true },
  { name: 'X-bar', brokenIndex: 3, relationIndex: 1, sourceId: 'c1', values: ['did'], missingClosers: false }
];
const payloadFor = ({ brokenIndex, relationIndex, sourceId, values }) => ({
  derivationStages: Array.from({ length: 5 }, (_, index) => index < brokenIndex
    ? stage([node(`earlier_${index}`)])
    : index === brokenIndex
      ? stage([node(sourceId)], [
        ...Array.from({ length: relationIndex }, () => relation(sourceId, { context: 'Preserved content' })),
        relation(sourceId, values)
      ])
      : stage([{ refId: sourceId }]))
});

for (const sample of fableCases) {
  test(`Fable ${sample.name}: identify the original values field before resolving dependent references`, () => {
    const payload = payloadFor(sample);
    const original = structuredClone(payload);
    assert.throws(() => normalize(payload), (error) => {
      assert.ok(error instanceof ParseApiError);
      assert.equal(error.failure.stageIndex, sample.brokenIndex);
      assert.equal(error.failure.analysisIndex, 0);
      assert.equal(error.failure.fieldPath, `$.derivationStages[${sample.brokenIndex}].relations[${sample.relationIndex}].values`);
      assert.equal(error.failure.processingStep, 'stage-shape');
      assert.equal(error.failure.expectedForm, 'a nonempty object with named entries');
      assert.deepEqual(error.failure.offendingValue, sample.values);
      assert.match(error.message, /expected a nonempty object with named entries; received an array/);
      assert.equal(error.failure.message, error.message);
      return true;
    });
    assert.deepEqual(payload, original);

    // Explicit inspection correction only. Normalization must never do this wrapping.
    const corrected = structuredClone(payload);
    corrected.derivationStages[sample.brokenIndex].relations[sample.relationIndex].values = { notation: sample.values };
    const result = normalize(corrected).analyses[0];
    assert.equal(result.derivationStages.length, 5);
    assert.equal(result.derivationStages[sample.brokenIndex + 1].workspaceForest[0].id, sample.sourceId);
    assert.deepEqual(payload, original);
  });

  test(`Fable ${sample.name}: review receipts keep precise diagnostics and unchanged raw bytes`, () => {
    const complete = JSON.stringify(payloadFor(sample));
    const raw = Buffer.from(sample.missingClosers ? complete.slice(0, -2) : complete);
    const originalBytes = Buffer.from(raw);
    const result = runQualificationAttempt({ attempt, rawOutputBytes: raw });
    assert.equal(result.receipt.outcome.phase, 'normalization');
    assert.equal(result.receipt.outcome.failure.stageIndex, sample.brokenIndex);
    assert.match(result.receipt.outcome.failure.message, /\.values: expected/);
    assert.equal(result.receipt.rawOutput.sha256, createHash('sha256').update(originalBytes).digest('hex'));
    assert.equal(result.bundle, null);
    assert.deepEqual(result.replayProjections, []);
    assert.deepEqual(raw, originalBytes);
    assert.deepEqual(result.inspection.payload, payloadFor(sample));
    assert.equal(result.inspection.analyses[0].stages.length, 5);
    assert.ok(result.inspection.analyses[0].stages.every((entry) => Array.isArray(entry.workspaceForest)));
    const inspected = result.inspection.analyses[0].stages[sample.brokenIndex];
    assert.deepEqual(inspected.authoredStage.relations[sample.relationIndex].values, sample.values);
    assert.equal(result.inspection.analyses[0].stages[sample.brokenIndex + 1].workspaceForest[0].id, sample.sourceId);
    assert.equal(result.inspection.rawOutput.sha256, result.receipt.rawOutput.sha256);
    assert.deepEqual(Buffer.from(result.inspection.rawOutput.data, 'base64'), originalBytes);
    assert.deepEqual(result.inspection.repairDiagnostics, result.receipt.ingress.repairDiagnostics);
    if (sample.missingClosers) {
      assert.deepEqual(result.receipt.ingress.repairDiagnostics, [{
        kind: 'append_closers_at_end_of_output', candidateByteOffset: originalBytes.byteLength,
        removedText: '', insertedText: ']}', removedBytesHex: '', insertedBytesHex: '5d7d'
      }]);
    } else {
      assert.deepEqual(result.receipt.ingress.repairDiagnostics, []);
    }
  });
}

test('a complete final tree cannot conceal a discarded earlier stage', () => {
  const mutations = [
    () => null,
    (entry) => ({ ...entry, extra: 'unexpected field' }),
    (entry) => ({ ...entry, statement: 1 }),
    (entry) => ({ ...entry, stageRecord: '' }),
    (entry) => ({ ...entry, relations: {} }),
    (entry) => ({ ...entry, relations: [relation('middle', ['unwrapped'])] }),
    (entry) => ({ ...entry, workspaceForest: undefined })
  ];
  for (const mutate of mutations) {
    const payload = { derivationStages: [stage([node('first')]), mutate(stage([node('middle')])), stage([node('last')])] };
    const original = structuredClone(payload);
    assert.throws(() => normalize(payload), (error) => {
      assert.equal(error.failure.stageIndex, 1);
      assert.match(error.failure.fieldPath, /^\$\.derivationStages\[1\]/);
      assert.equal(error.failure.processingStep, 'stage-shape');
      return true;
    });
    assert.deepEqual(payload, original);
    assert.throws(() => __test__.normalizeDerivationStagesToDerivationFrames(payload.derivationStages), ParseApiError);
  }
});

test('correcting the first malformed field exposes the next at its original stage', () => {
  const payload = payloadFor(fableCases[0]);
  payload.derivationStages[4].relations = [relation('d_john_hi', ['wh'])];
  assert.throws(() => normalize(payload), (error) => error.failure.stageIndex === 2);
  payload.derivationStages[2].relations[0].values = { notation: ['phi', 'Nom'] };
  assert.throws(() => normalize(payload), (error) => {
    assert.equal(error.failure.fieldPath, '$.derivationStages[4].relations[0].values');
    assert.deepEqual(error.failure.offendingValue, ['wh']);
    return true;
  });
  assert.equal(payload.derivationStages.length, 5);
});

test('non-text stage records identify the original field without coercion or history loss', () => {
  for (const stageRecord of [42, true, ['An explanation'], { text: 'An explanation' }]) {
    const payload = { derivationStages: [stage([node('first')]), {
      ...stage([node('middle')]), stageRecord
    }, stage([{ refId: 'middle' }])] };
    const original = structuredClone(payload);
    assert.throws(() => normalize(payload), (error) => {
      assert.equal(error.failure.fieldPath, '$.derivationStages[1].stageRecord');
      assert.equal(error.failure.expectedForm, 'a nonblank string');
      assert.deepEqual(error.failure.offendingValue, stageRecord);
      assert.equal(error.failure.processingStep, 'stage-shape');
      return true;
    });
    assert.deepEqual(payload, original);
  }
});

test('retained words in a model-authored silent copy do not enter the pronounced sequence', () => {
  const payload = { derivationStages: [stage([{
    id: 'root', label: 'XP', children: [
      { id: 'lower', label: 'N', word: 'Mia', silent: true, lineageId: 'nominal', children: [] },
      { ...node('upper'), lineageId: 'nominal' }
    ]
  }])] };
  const original = structuredClone(payload);
  const result = normalize(payload).analyses[0];
  assert.equal(result.derivationStages[0].workspaceForest[0].children[0].word, 'Mia');
  assert.equal(result.tree.children[0].silent, true);
  assert.equal(result.tree.children[0].word, 'Mia');
  assert.equal(result.tree.children[0].tokenIndex, undefined);
  assert.equal(result.tree.children[1].tokenIndex, 0);
  assert.deepEqual(payload, original);
});

test('malformed relation entries identify their exact field, without changing open literal content', () => {
  const cases = [
    [{ relation: 7 }, '.relation'],
    [{ anchors: [] }, '.anchors'],
    [{ priorAnchors: [] }, '.priorAnchors'],
    [{ values: { notation: [3] } }, '.values["notation"][0]'],
    [{ values: { '': 'literal' } }, '.values[""]']
  ];
  for (const [changes, path] of cases) {
    const payload = { derivationStages: [stage([node('n')], [{ ...relation('n', { text: 'value' }), ...changes }])] };
    assert.throws(() => normalize(payload), (error) => {
      assert.equal(error.failure.fieldPath, `$.derivationStages[0].relations[0]${path}`);
      return true;
    });
  }
  const values = { 'open name': '', notation: ['x_i', '', 'x_i'] };
  const payload = { derivationStages: [stage([node('n')], [relation('n', values)])] };
  assert.deepEqual(normalize(payload).analyses[0].derivationStages[0].relations[0].values, values);
});

test('a genuine missing subtree reference reports the original node path', () => {
  const payload = { derivationStages: [stage([node('first')]), stage([{ refId: 'not_defined' }])] };
  assert.throws(() => normalize(payload), (error) => {
    assert.equal(error.failure.processingStep, 'workspace-expansion');
    assert.equal(error.failure.stageIndex, 1);
    assert.equal(error.failure.fieldPath, '$.derivationStages[1].workspaceForest[0].refId');
    assert.equal(error.failure.offendingValue, 'not_defined');
    assert.match(error.message, /no earlier stage defines node "not_defined"/);
    return true;
  });
});

test('inspection retains broken workspaces and blocks later expansion rather than using stale history', () => {
  const stages = [stage([node('n')]), stage([{ refId: 'missing' }]), stage([{ refId: 'n' }])];
  const original = structuredClone(stages);
  const result = __test__.inspectDerivationWorkspaces(stages);
  assert.equal(result.length, 3);
  assert.equal(result[0].workspaceForest[0].id, 'n');
  assert.equal(result[1].workspaceForest, null);
  assert.equal(result[1].diagnostic.fieldPath, '$.derivationStages[1].workspaceForest[0].refId');
  assert.equal(result[2].workspaceForest, null);
  assert.equal(result[2].blockedByStageIndex, 1);
  assert.deepEqual(result.map((entry) => entry.authoredStage), original);
  assert.deepEqual(stages, original);
});

test('inspection keeps separate analysis indices and does not require a matching final sentence', () => {
  const payload = { analyses: [payloadFor(fableCases[0]), { derivationStages: [stage([node('other')])] }] };
  const result = runQualificationAttempt({ attempt: { ...attempt, request: { ...attempt.request, sentence: 'Different input' } },
    rawOutputBytes: Buffer.from(JSON.stringify(payload)) });
  assert.deepEqual(result.inspection.analyses.map((entry) => entry.analysisIndex), [0, 1]);
  assert.equal(result.inspection.analyses[1].stages[0].workspaceForest[0].word, 'Mia');
  assert.deepEqual(result.inspection.payload, payload);
  assert.equal(result.bundle, null);
  assert.deepEqual(result.replayProjections, []);
});

test('a duplicate inside a carried subtree points to the authored refId, not a synthetic child path', () => {
  const payload = { derivationStages: [
    stage([{ id: 'root', label: 'NP', children: [node('n')] }]),
    stage([node('n'), { refId: 'root' }])
  ] };
  assert.throws(() => normalize(payload), (error) => {
    assert.equal(error.failure.fieldPath, '$.derivationStages[1].workspaceForest[1].refId');
    assert.equal(error.failure.offendingValue, 'root');
    assert.match(error.message, /duplicate active node id n/);
    return true;
  });
});

test('diagnostics include the original analysis index within an ambiguity envelope', () => {
  const payload = { analyses: [{ derivationStages: [stage([node('n')])] }, payloadFor(fableCases[0])] };
  const original = structuredClone(payload);
  assert.throws(() => normalize(payload), (error) => {
    assert.equal(error.failure.analysisIndex, 1);
    assert.equal(error.failure.stageIndex, 2);
    assert.equal(error.failure.fieldPath, '$.analyses[1].derivationStages[2].relations[0].values');
    assert.match(error.message, /^Analysis 2: Stage 3,/);
    return true;
  });
  assert.deepEqual(payload, original);
});

test('the generation route preserves every raw stage and diagnostic without a replacement call', async () => {
  const raw = JSON.stringify(payloadFor(fableCases[0])).slice(0, -2);
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'provider-free-test-key';
  let calls = 0;
  try {
    const routes = createParseRoutes({
      ParseApiError,
      normalizeParseBundle: __test__.normalizeParseBundle,
      parseModelJsonDetailed: __test__.parseModelJsonDetailed,
      generateOpenAI: async () => {
        calls += 1;
        return { text: raw, status: 'completed', candidates: [{ finishReason: 'COMPLETED' }] };
      }
    });
    await assert.rejects(() => routes.parseSentenceWithOpenAI('Mia'), (error) => {
      assert.equal(error.failure.fieldPath, '$.derivationStages[2].relations[0].values');
      assert.equal(error.failure.expectedForm, 'a nonempty object with named entries');
      assert.match(error.failure.message, /received an array/);
      assert.equal(Buffer.from(error.rawOutput.data, 'base64').toString('utf8'), raw);
      assert.equal(error.details.payloadRepairDiagnostics[0].kind, 'append_closers_at_end_of_output');
      const formatted = formatApiError(error).body.error;
      assert.deepEqual(formatted.failure, error.failure);
      assert.equal(formatted.generationRecord.outcome.attempts.length, 1);
      assert.equal(Buffer.from(formatted.rawOutput.data, 'base64').toString('utf8'), raw);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test('optional node diagnostics preserve malformed fields and unfamiliar metadata without new rejection rules', () => {
  const cases = [
    ['word', { literal: 'Mia' }, '.word', { literal: 'Mia' }],
    ['silent', 'false', '.silent', 'false'],
    ['lineageId', { identity: 'n' }, '.lineageId', { identity: 'n' }],
    ['lineageId', ' ', '.lineageId', ' '],
    ['tokenIndex', '0', '.tokenIndex', '0'],
    ['tokenIndex', -1, '.tokenIndex', -1],
    ['tokenIndex', 0.5, '.tokenIndex', 0.5],
    ['surfaceSpan', [0], '.surfaceSpan', [0]],
    ['surfaceSpan', [0, '1'], '.surfaceSpan[1]', '1'],
    ['surfaceSpan', [2, 1], '.surfaceSpan[1]', 1],
    ['silent', null, '.silent', null]
  ];
  for (const [field, value, suffix, observed] of cases) {
    const authored = { ...node('earlier'), [field]: value, features: 42,
      unfamiliar: { id: 'not-a-syntax-node', label: 'N', children: [] } };
    const payload = { derivationStages: [stage([{ id: 'p', label: 'NP', children: [authored] }]), stage([node('final')])] };
    const original = structuredClone(payload);
    const result = __test__.inspectDerivationWorkspaces(payload.derivationStages);
    const issue = result[0].diagnostics.find((diagnostic) => diagnostic.ruleId === 'DERIVATION_NODE_OPTIONAL_FIELD');
    assert.equal(issue.fieldPath, `$.derivationStages[0].workspaceForest[0].children[0]${suffix}`);
    assert.deepEqual(issue.offendingValue, observed);
    assert.equal(issue.processingStep, 'node-shape');
    assert.match(issue.message, /expected/);
    assert.deepEqual(result[0].workspaceForest[0].children[0], authored);
    assert.equal(normalize(payload).analyses[0].derivationStages.length, 2);
    assert.deepEqual(payload, original);
  }
});

test('anchor inspection checks every array item in the exact current or immediate-prior workspace', () => {
  const stages = [
    stage([node('old'), { id: 'carried-parent', label: 'NP', children: [{ ...node('carried-child'), tokenIndex: 1 }] }], [
      { relation: 'Open claim', anchors: { witness: 'future' }, priorAnchors: { witness: 'old' } }
    ]),
    stage([node('current'), { refId: 'carried-parent' }], [{
      relation: 'Another open claim',
      anchors: { 'open.role': ['current', 'old', 'future', 'missing', 'carried-child', 'carried-child'] },
      priorAnchors: { witnesses: ['old', 'current', 'future', 'carried-child'] },
      values: { literal: ['missing', 'missing', ''] }
    }]),
    stage([{ ...node('future'), extra: { id: 'metadata-only', label: 'N', children: [] } }], [{
      relation: 'Open claim', anchors: { witness: 'metadata-only' }, priorAnchors: { tooOld: 'old' }
    }])
  ];
  const original = structuredClone(stages);
  const result = __test__.inspectDerivationWorkspaces(stages);
  assert.deepEqual(result[0].anchorChecks.map(({ status }) => status), ['future-only', 'current-only']);
  assert.equal(result[0].anchorChecks[1].requiredStageIndex, -1);
  assert.deepEqual(result[1].anchorChecks.map(({ nodeId, status, carried }) => [nodeId, status, carried]), [
    ['current', 'resolved', false], ['old', 'previous-only', false], ['future', 'future-only', false],
    ['missing', 'missing', false], ['carried-child', 'resolved', true], ['carried-child', 'resolved', true],
    ['old', 'resolved', false], ['current', 'current-only', false], ['future', 'future-only', false],
    ['carried-child', 'resolved', false]
  ]);
  assert.deepEqual(result[1].diagnostics.map(({ fieldPath }) => fieldPath), [
    '$.derivationStages[1].relations[0].anchors["open.role"][1]',
    '$.derivationStages[1].relations[0].anchors["open.role"][2]',
    '$.derivationStages[1].relations[0].anchors["open.role"][3]',
    '$.derivationStages[1].relations[0].priorAnchors["witnesses"][1]',
    '$.derivationStages[1].relations[0].priorAnchors["witnesses"][2]'
  ]);
  assert.deepEqual(result[1].anchorChecks[4].occurrencePaths, ['$.derivationStages[1].workspaceForest[1].refId']);
  assert.deepEqual(result[2].anchorChecks.map(({ status }) => status), ['missing', 'previous-only']);
  assert.deepEqual(result.map(({ authoredStage }) => authoredStage), original);
  assert.deepEqual(stages, original);
});

test('duplicate IDs remain inspectable and anchor ambiguity points to direct and carried occurrences', () => {
  const stages = [stage([{ id: 'parent', label: 'NP', children: [node('n')] }]),
    stage([node('n'), { refId: 'parent' }], [{ relation: 'Open', anchors: { witness: ['n', 'parent'] } }]),
    stage([{ refId: 'parent' }])];
  const inspected = __test__.inspectDerivationWorkspaces(stages);
  assert.equal(inspected[1].workspaceForest.length, 2);
  assert.equal(inspected[1].diagnostics[0].fieldPath, '$.derivationStages[1].workspaceForest[1].refId');
  assert.equal(inspected[1].anchorChecks[0].status, 'duplicate');
  assert.deepEqual(inspected[1].anchorChecks[0].occurrencePaths, [
    '$.derivationStages[1].workspaceForest[0].id', '$.derivationStages[1].workspaceForest[1].refId'
  ]);
  assert.equal(inspected[1].anchorChecks[1].status, 'resolved');
  assert.equal(inspected[2].workspaceForest, null);
  assert.equal(inspected[2].blockedByStageIndex, 1);
  assert.throws(() => normalize({ derivationStages: stages }), (error) => error.failure.ruleId === 'DERIVATION_WORKSPACE_VALID');
});

test('inspection collects independent malformed fields across all original stages and array items', () => {
  const stages = [stage([node('n')], [{ relation: 3, anchors: { witness: ['n', 4, ''] },
    priorAnchors: { witness: [null] }, values: { notation: ['x', 8, ['nested']] } }]),
  { ...stage([{ refId: 'n' }], [relation('n', ['wh'])]), stageRecord: false }];
  const inspected = __test__.inspectDerivationWorkspaces(stages);
  assert.deepEqual(inspected.flatMap(({ diagnostics }) => diagnostics)
    .filter(({ processingStep }) => processingStep === 'stage-shape').map(({ fieldPath }) => fieldPath), [
    '$.derivationStages[0].relations[0].relation',
    '$.derivationStages[0].relations[0].anchors["witness"][1]',
    '$.derivationStages[0].relations[0].anchors["witness"][2]',
    '$.derivationStages[0].relations[0].priorAnchors["witness"][0]',
    '$.derivationStages[0].relations[0].values["notation"][1]',
    '$.derivationStages[0].relations[0].values["notation"][2]',
    '$.derivationStages[1].stageRecord', '$.derivationStages[1].relations[0].values'
  ]);
  assert.equal(inspected[1].workspaceForest[0].id, 'n');
});

test('final alignment reports the authored token or span item instead of an incomplete-generation cause', () => {
  for (const [changes, suffix, observed, expected] of [
    [{ tokenIndex: 999 }, '.tokenIndex', 999, 'the integer 0'],
    [{ tokenIndex: '0' }, '.tokenIndex', '0', 'the integer 0'],
    [{ surfaceSpan: [0, 999] }, '.surfaceSpan[1]', 999, 'the integer 0'],
    [{ surfaceSpan: '0' }, '.surfaceSpan', '0', '[0,0]']
  ]) {
    const payload = { analyses: [{ derivationStages: [stage([node('first')])] },
      { derivationStages: [stage([{ ...node('carried'), ...changes }]), stage([{ refId: 'carried' }])] }] };
    const original = structuredClone(payload);
    assert.throws(() => normalize(payload), (error) => {
      assert.equal(error.code, 'BAD_MODEL_RESPONSE');
      assert.equal(error.failure.ruleId, 'DERIVATION_TOKEN_ALIGNMENT');
      assert.equal(error.failure.processingStep, 'token-alignment');
      assert.equal(error.failure.fieldPath, `$.analyses[1].derivationStages[0].workspaceForest[0]${suffix}`);
      assert.deepEqual(error.failure.offendingValue, observed);
      assert.equal(error.failure.expectedForm, expected);
      assert.doesNotMatch(error.message, /incomplete|converge/i);
      return true;
    });
    assert.deepEqual(payload, original);
  }
});

test('qualification keeps every analysis and independently records normalization after an earlier failure', () => {
  const payload = { analyses: [payloadFor(fableCases[0]), { derivationStages: [stage([node('good')])] },
    { derivationStages: [stage([{ ...node('bad'), tokenIndex: 99 }])] }] };
  const raw = Buffer.from(JSON.stringify(payload));
  const result = runQualificationAttempt({ attempt, rawOutputBytes: raw });
  assert.deepEqual(result.inspection.payload, payload);
  assert.deepEqual(Buffer.from(result.inspection.rawOutput.data, 'base64'), raw);
  assert.deepEqual(result.inspection.analyses.map(({ normalization }) => normalization.status), ['failed', 'succeeded', 'failed']);
  assert.equal(result.inspection.analyses[0].stages[2].diagnostics[0].fieldPath, '$.analyses[0].derivationStages[2].relations[0].values');
  assert.equal(result.inspection.analyses[2].normalization.failure.fieldPath, '$.analyses[2].derivationStages[0].workspaceForest[0].tokenIndex');
  assert.equal(result.inspection.analyses[1].stages[0].workspaceForest[0].id, 'good');
  assert.equal(result.bundle, null);
  assert.deepEqual(result.analysisBundles, []);
  assert.deepEqual(result.replayProjections, []);
  assert.equal(result.inspection.replayStatus, 'not-compiled');
});

test('alignment provenance follows the carried subtree version, not a later standalone definition of its child', () => {
  const payload = { derivationStages: [
    stage([{ id: 'parent', label: 'NP', children: [{ ...node('n'), tokenIndex: 99 }] }]),
    stage([node('n')]),
    stage([{ refId: 'parent' }])
  ] };
  assert.throws(() => normalize(payload), (error) => {
    assert.equal(error.failure.fieldPath, '$.derivationStages[0].workspaceForest[0].children[0].tokenIndex');
    assert.equal(error.failure.offendingValue, 99);
    return true;
  });
});

test('normalization success retains missing-anchor diagnostics and does not certify linguistic or visual review', () => {
  const payload = { derivationStages: [stage([node('n')], [{ relation: 'Open', anchors: { witness: 'missing' } }])] };
  assert.equal(normalize(payload).analyses.length, 1);
  const result = runQualificationAttempt({ attempt, rawOutputBytes: Buffer.from(JSON.stringify(payload)) });
  assert.equal(result.inspection.analyses[0].normalization.status, 'succeeded');
  assert.equal(result.inspection.analyses[0].stages[0].diagnostics[0].processingStep, 'anchor-resolution');
  assert.equal(result.inspection.linguisticReviewStatus, 'unreviewed');
  assert.equal(result.inspection.visualReviewStatus, 'unreviewed');
  assert.equal(result.receipt.outcome.reviewDisposition, 'unreviewed');
});

test('the full final forest is preserved for convergence review without enforcing linguistic branching rules', () => {
  const tree = { id: 'p', label: 'NP', children: [node('n'),
    { id: 'wordless1', label: 'T', children: [] }, { id: 'wordless2', label: 'C', children: [] }] };
  const payload = { derivationStages: [stage([tree, { id: 'extra', label: 'D', children: [] }])] };
  const original = structuredClone(payload);
  const normalized = __test__.normalizeParseBundle(payload, 'minimalism', 'Mia', 'claude', true);
  assert.equal(normalized.analyses[0].tree.children.length, 3);
  assert.equal(normalized.analyses[0].derivationStages[0].workspaceForest.length, 2);
  const [inspection] = __test__.inspectDerivationWorkspaces(payload.derivationStages);
  const issue = inspection.diagnostics.find(({ ruleId }) => ruleId === 'DERIVATION_FINAL_WORKSPACE_MULTIPLE_ROOTS');
  assert.equal(issue.processingStep, 'workspace-convergence');
  assert.deepEqual(issue.offendingValue, ['p', 'extra']);
  assert.match(issue.message, /does not establish whole-workspace convergence/);
  assert.deepEqual(payload, original);
});

test('duplicate carried token indexes and missing required node fields retain their authored locations and values', () => {
  const stages = [stage([{ id: 'p', label: 'NP', children: [node('n')] }]), stage([node('other'), { refId: 'p' }])];
  const inspection = __test__.inspectDerivationWorkspaces(stages);
  const issue = inspection[1].diagnostics.find(({ ruleId }) => ruleId === 'DERIVATION_TOKEN_INDEX_UNIQUE');
  assert.equal(issue.fieldPath, '$.derivationStages[1].workspaceForest[1].refId');
  assert.equal(issue.offendingValue, 'p');
  assert.throws(() => normalize({ derivationStages: [stage([{ id: 'n', children: [] }])] }), (error) => {
    assert.equal(error.failure.fieldPath, '$.derivationStages[0].workspaceForest[0].label');
    assert.deepEqual(error.failure.offendingValue, { kind: 'missing' });
    return true;
  });
});
