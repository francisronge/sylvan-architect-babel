import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createReportStarSchemaReceipt,
  hashReportStarSchemaData,
  REPORT_TABLE_NAMES
} from '../bench/reportStarSchema.js';

const digest = (text) => hashReportStarSchemaData({ text });
const release = {
  id: 'release-dev-1',
  suiteVer: 'suite-v1',
  contractHashes: { parse: digest('contract') },
  engineVer: 'engine-v1',
  window: 'opaque-window',
  policyVer: 'policy-v1'
};
const model = {
  registryId: 'registry-model-1',
  name: 'Externally Selected Model',
  lab: 'External Lab',
  manifestRef: 'manifest://model-1'
};
const condition = {
  id: 'condition-1',
  releaseId: release.id,
  modelId: model.registryId,
  resolvedVersion: 'resolved-v1',
  aliasWindow: null,
  host: 'external-host',
  tier: 'external-tier',
  framework: 'external-framework',
  sentParams: { externallySupplied: true },
  carrier: 'external-carrier'
};
const itemV1 = {
  itemVersionId: 'item-alpha-v1',
  itemId: 'item-alpha',
  vN: 1,
  contentAxes: { language: 'external-language' },
  flags: [{ name: 'external-purpose-flag' }],
  statusHistory: [{ state: 'external-state-v1' }],
  dispositions: []
};
const itemV2 = {
  ...itemV1,
  itemVersionId: 'item-alpha-v2',
  vN: 2,
  statusHistory: [
    ...itemV1.statusHistory,
    { state: 'external-state-v2' }
  ],
  dispositions: [{ disposition: 'external-revised' }]
};
const run = {
  id: 'run-1',
  conditionId: condition.id,
  itemVersionId: itemV2.itemVersionId,
  outcomeClass: 'external-outcome-class',
  subCause: null,
  partition: 'native',
  finishReason: 'external-finish-reason',
  tokens: {
    inUncached: 10,
    inCached: 2,
    out: 20,
    reasoning: 5
  },
  latencyMs: 123.5,
  costUSD: 0.25,
  rawHash: digest('raw-output'),
  bundleRef: 'bundle://run-1'
};
const judgment = {
  runId: run.id,
  reviewerId: 'external-reviewer',
  dimension: 'external-dimension',
  value: { authoredScaleValue: 'external-value' },
  rubricVer: 'rubric-v1',
  adjudicated: false,
  blindingRecord: { ref: 'blind://run-1', sha256: digest('blind') }
};
const score = {
  estimandId: 'external-estimand-1',
  conditionScope: [condition.id],
  value: 0.5,
  ciLow: 0.2,
  ciHigh: 0.8,
  method: 'externally-selected-method',
  clusterSpec: { externallySupplied: true },
  multiplicityFamily: null
};
const correction = {
  itemId: itemV1.itemId,
  fromV: 1,
  toV: 2,
  reason: 'external-correction-reason',
  taxonomyClass: 'external-taxonomy-class',
  affectedScores: [score.estimandId]
};
const tables = {
  Release: [release],
  Model: [model],
  Condition: [condition],
  ItemVersion: [itemV1, itemV2],
  Run: [run],
  Judgment: [judgment],
  Score: [score],
  Correction: [correction]
};
const tableSources = (sourceTables = tables) => Object.fromEntries(
  REPORT_TABLE_NAMES.map((tableName) => [
    tableName,
    {
      sourceRef: `archive://report/${tableName}`,
      sourceSha256: hashReportStarSchemaData(sourceTables[tableName])
    }
  ])
);
const plan = (overrides = {}, sourceTables = tables) => ({
  reportDatasetId: 'report-dataset-1',
  schemaIdentity: 'bm12-eight-table-star-schema',
  rawDerivedIdentity: 'raw-facts-and-externally-derived-scores-remain-distinct',
  publicationIdentity: 'dataset-generation-is-not-publication-authorization',
  tableSources: tableSources(sourceTables),
  provenance: { authority: 'external-report-process' },
  ...overrides
});
const createReceipt = (overrides = {}) => createReportStarSchemaReceipt({
  plan: plan(),
  tables,
  ...overrides
});

test('the generator emits exactly the eight BM12 star-schema tables', () => {
  const receipt = createReceipt();
  assert.deepEqual(Object.keys(receipt.tables), REPORT_TABLE_NAMES);
  assert.deepEqual(receipt.rowCounts, {
    Release: 1,
    Model: 1,
    Condition: 1,
    ItemVersion: 2,
    Run: 1,
    Judgment: 1,
    Score: 1,
    Correction: 1
  });
  assert.equal(receipt.releaseId, release.id);
});

test('release contract hashes are exact and non-empty', () => {
  for (const contractHashes of [{}, { parse: 'not-a-hash' }]) {
    const changed = {
      ...tables,
      Release: [{ ...release, contractHashes }]
    };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /contractHashes must not be empty|lowercase SHA-256/
    );
  }
});

test('raw facts and external scores remain distinct and unchanged', () => {
  const receipt = createReceipt();
  assert.deepEqual(receipt.tables.Run[0], run);
  assert.deepEqual(receipt.tables.Judgment[0], judgment);
  assert.deepEqual(receipt.tables.Score[0], score);
  assert.equal(
    receipt.reportTreatment,
    'validated-star-schema-data-no-score-computation-or-publication-authorization'
  );
});

test('conditions require one declared release and model', () => {
  for (const changedCondition of [
    { ...condition, releaseId: 'unknown-release' },
    { ...condition, modelId: 'unknown-model' }
  ]) {
    const changed = { ...tables, Condition: [changedCondition] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /must reference the report Release|must reference a declared Model/
    );
  }
});

test('conditions preserve exactly one resolved-version identity', () => {
  for (const changedCondition of [
    { ...condition, resolvedVersion: null, aliasWindow: null },
    { ...condition, aliasWindow: 'alias-window' }
  ]) {
    const changed = { ...tables, Condition: [changedCondition] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /exactly one of resolvedVersion or aliasWindow/
    );
  }
  const aliasCondition = {
    ...condition,
    resolvedVersion: null,
    aliasWindow: 'external-alias-window'
  };
  const changed = { ...tables, Condition: [aliasCondition] };
  assert.equal(
    createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }).tables.Condition[0].aliasWindow,
    aliasCondition.aliasWindow
  );
});

test('runs must join exact conditions and item versions', () => {
  for (const changedRun of [
    { ...run, conditionId: 'unknown-condition' },
    { ...run, itemVersionId: 'unknown-item-version' }
  ]) {
    const changed = { ...tables, Run: [changedRun] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /must reference a declared Condition|must reference a declared ItemVersion/
    );
  }
});

test('run partitions, measured quantities, tokens, and hashes fail closed', () => {
  for (const changedRun of [
    { ...run, partition: 'invented-partition' },
    { ...run, latencyMs: -1 },
    { ...run, costUSD: Number.NaN },
    { ...run, tokens: { ...run.tokens, reasoning: -1 } },
    { ...run, rawHash: 'not-a-hash' }
  ]) {
    const changed = { ...tables, Run: [changedRun] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /partition|non-negative finite|non-negative safe integer|lowercase SHA-256|finite JSON data/
    );
  }
});

test('judgments require exact run joins and unique reviewer dimensions', () => {
  const unknown = { ...judgment, runId: 'unknown-run' };
  let changed = { ...tables, Judgment: [unknown] };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /must reference a declared Run/
  );
  changed = { ...tables, Judgment: [judgment, structuredClone(judgment)] };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /Judgment keys must be unique/
  );
});

test('scores preserve external methods and require declared condition scopes', () => {
  const receipt = createReceipt();
  assert.equal(receipt.tables.Score[0].method, score.method);
  const changedScore = {
    ...score,
    conditionScope: ['unknown-condition']
  };
  const changed = { ...tables, Score: [changedScore] };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /must reference declared Conditions/
  );
});

test('score intervals are finite, ordered, and never clipped', () => {
  const unboundedScore = {
    ...score,
    value: 1.2,
    ciLow: -0.4,
    ciHigh: 1.8
  };
  let changed = { ...tables, Score: [unboundedScore] };
  assert.deepEqual(
    createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }).tables.Score[0],
    unboundedScore
  );
  for (const changedScore of [
    { ...score, ciLow: 0.6 },
    { ...score, ciHigh: Number.POSITIVE_INFINITY }
  ]) {
    changed = { ...tables, Score: [changedScore] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /ciLow <= value <= ciHigh|finite number|finite JSON data/
    );
  }
});

test('corrections join both item versions and only declared scores', () => {
  for (const changedCorrection of [
    { ...correction, toV: 3 },
    { ...correction, affectedScores: ['unknown-score'] }
  ]) {
    const changed = { ...tables, Correction: [changedCorrection] };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /both declared ItemVersion coordinates|must reference declared Scores/
    );
  }
});

test('primary and composite identities reject relabel collisions', () => {
  const duplicateModel = [model, { ...model, name: 'Relabeled Name' }];
  let changed = { ...tables, Model: duplicateModel };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /Model keys must be unique/
  );
  const duplicateCoordinate = [
    itemV1,
    { ...itemV1, itemVersionId: 'relabeled-item-version' }
  ];
  changed = { ...tables, ItemVersion: duplicateCoordinate };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /itemId\/vN coordinates must be unique/
  );
});

test('substantive model, condition, and run rows resist ID relabeling', () => {
  for (const [tableName, row, idField] of [
    ['Model', model, 'registryId'],
    ['Condition', condition, 'id'],
    ['Run', run, 'id']
  ]) {
    const relabeled = {
      ...structuredClone(row),
      [idField]: `relabeled-${row[idField]}`
    };
    const changed = { ...tables, [tableName]: [row, relabeled] };
    if (tableName === 'Condition') {
      changed.Run = [];
      changed.Judgment = [];
      changed.Score = [];
      changed.Correction = [];
    } else if (tableName === 'Run') {
      changed.Judgment = [];
    }
    const expectedError = {
      Model: 'Model manifestRef values must be unique',
      Run: 'Run bundleRef values must be unique'
    }[tableName] ?? `${tableName} substantive definitions must be unique`;
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      new RegExp(expectedError)
    );
  }
});

test('manifest and bundle artifact identities resist relabeling', () => {
  let changed = {
    ...tables,
    Model: [model, {
      ...model,
      registryId: 'registry-model-2',
      name: 'Second Label'
    }]
  };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /Model manifestRef values must be unique/
  );
  changed = {
    ...tables,
    Run: [run, {
      ...run,
      id: 'run-2',
      outcomeClass: 'different-outcome'
    }],
    Judgment: []
  };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /Run bundleRef values must be unique/
  );
});

test('score definitions resist estimand-ID relabeling', () => {
  const relabeledScore = {
    ...score,
    estimandId: 'relabeled-estimand'
  };
  const changed = {
    ...tables,
    Score: [score, relabeledScore],
    Correction: []
  };
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /Score substantive definitions must be unique/
  );
});

test('distinct estimands may preserve coincident values without merging', () => {
  const conditionTwo = {
    ...condition,
    id: 'condition-2',
    tier: 'external-tier-2'
  };
  const scoreOne = {
    ...score,
    conditionScope: [condition.id, conditionTwo.id]
  };
  const scoreTwo = {
    ...score,
    estimandId: 'external-estimand-2',
    conditionScope: [conditionTwo.id, condition.id]
  };
  const changed = {
    ...tables,
    Condition: [condition, conditionTwo],
    Score: [scoreOne, scoreTwo],
    Correction: []
  };
  const receipt = createReportStarSchemaReceipt({
    plan: plan({}, changed),
    tables: changed
  });
  assert.deepEqual(
    receipt.tables.Score.map(({ estimandId }) => estimandId),
    [scoreOne.estimandId, scoreTwo.estimandId]
  );
});

test('all eight externally supplied source tables are hash-bound', () => {
  for (const tableName of REPORT_TABLE_NAMES) {
    const changed = structuredClone(tables);
    changed[tableName] = [...changed[tableName]];
    if (tableName === 'Release') {
      changed.Release[0].window = 'changed-window';
    } else {
      changed[tableName] = [];
    }
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan(),
        tables: changed
      }),
      new RegExp(`tables\\.${tableName} does not match its source SHA-256`)
    );
  }
});

test('plans and tables reject policy-bearing extra fields', () => {
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: { ...plan(), rankingPolicy: 'invented' },
      tables
    }),
    /fields must be exact/
  );
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan(),
      tables: { ...tables, Composite: [] }
    }),
    /fields must be exact/
  );
  const changed = structuredClone(tables);
  changed.Score[0].claim = 'invented-claim';
  assert.throws(
    () => createReportStarSchemaReceipt({
      plan: plan({}, changed),
      tables: changed
    }),
    /fields must be exact/
  );
});

test('one release is mandatory while all fact tables may be empty', () => {
  const emptyFacts = Object.fromEntries(
    REPORT_TABLE_NAMES.map((tableName) => [
      tableName,
      tableName === 'Release' ? [release] : []
    ])
  );
  const receipt = createReportStarSchemaReceipt({
    plan: plan({}, emptyFacts),
    tables: emptyFacts
  });
  assert.equal(receipt.rowCounts.Release, 1);
  assert.equal(receipt.rowCounts.Run, 0);
  for (const releases of [[], [release, { ...release, id: 'release-2' }]]) {
    const changed = { ...emptyFacts, Release: releases };
    assert.throws(
      () => createReportStarSchemaReceipt({
        plan: plan({}, changed),
        tables: changed
      }),
      /exactly one release/
    );
  }
});

test('receipts are deterministic, immutable, and preserve callers', () => {
  const before = structuredClone(tables);
  const first = createReceipt();
  const second = createReceipt();
  assert.deepEqual(first, second);
  assert.deepEqual(tables, before);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.tables));
  assert.ok(Object.isFrozen(first.tables.Run[0]));
  assert.throws(() => {
    first.tables.Run[0].outcomeClass = 'changed';
  }, TypeError);
});
