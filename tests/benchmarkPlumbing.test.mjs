import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createBenchmarkRunPlan,
  createMemoryArtifactSink,
  createStubEngine,
  createStubTransport,
  runBenchmarkDryRun
} from '../bench/index.js';
import { FAILURE_CLASSES } from '../server/babelParser/validationErrors.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const plan = (overrides = {}) => ({
  runId: 'externally-assigned-run',
  itemRef: 'external-item-reference-only',
  condition: {
    conditionId: 'external-condition',
    providerIdentity: 'external-provider',
    modelIdentity: 'external-model@resolved-version',
    reasoningIdentity: 'external-native-setting',
    carrierIdentity: 'external-carrier',
    frameworkIdentity: 'external-framework',
    partitionIdentity: 'external-partition',
    hostRoute: 'external-host',
    apiVersion: 'external-api-version'
  },
  factorAssignments: {
    restructuring: 'external-assignment',
    values: true,
    priorAnchors: false,
    arbitraryFutureFactor: ['opaque', 7]
  },
  requestConfig: {
    externallySuppliedLimit: 1234,
    externallySuppliedParameter: 'opaque'
  },
  provenance: {
    contractHashes: ['external-contract-hash'],
    engineVersion: 'external-engine-version',
    runWindow: 'external-window'
  },
  ...overrides
});

const validArtifact = (name) => ({
  ok: true,
  artifactRef: `memory://${name}`,
  sha256: sha256(name)
});

const validComponents = ({ rawOutput, observeParse } = {}) => ({
  transport: createStubTransport({
    ok: true,
    rawOutput: rawOutput ?? '  {"authored":"名 β"}\\n',
    finishReason: 'external-finish-reason',
    latencyMs: 17,
    usage: {
      input: 3,
      output: 5,
      reasoning: 7
    },
    provenance: {
      externalTransportReceipt: 'opaque'
    }
  }),
  engine: (() => {
    const engine = createStubEngine({
      parseOutcome: validArtifact('parsed'),
      compileOutcome: validArtifact('compiled')
    });
    if (!observeParse) return engine;
    return {
      ...engine,
      parse: async (input) => {
        observeParse(input);
        return engine.parse(input);
      }
    };
  })(),
  artifactSink: createMemoryArtifactSink()
});

test('run plans require externally supplied identities and have no defaults', () => {
  const complete = createBenchmarkRunPlan(plan());
  assert.equal(complete.condition.carrierIdentity, 'external-carrier');
  assert.equal(complete.condition.reasoningIdentity, 'external-native-setting');
  assert.ok(Object.isFrozen(complete));

  const missingCarrier = plan();
  delete missingCarrier.condition.carrierIdentity;
  assert.throws(
    () => createBenchmarkRunPlan(missingCarrier),
    /condition.carrierIdentity must be a non-empty string/
  );

  assert.throws(
    () => createBenchmarkRunPlan({ ...plan(), sampleSize: 10 }),
    /extra=\[sampleSize\]/
  );
});

test('the dry run preserves raw bytes and emits a comparison-ready receipt', async () => {
  const rawOutput = '  {"authored":"名 β","spacing":"  exact  "}\\n';
  let observedRaw;
  const components = validComponents({
    rawOutput,
    observeParse: ({ rawOutput: received }) => {
      observedRaw = received;
    }
  });
  const receipt = await runBenchmarkDryRun({
    plan: plan(),
    ...components
  });
  const [write] = components.artifactSink.inspectWrites();

  assert.equal(observedRaw, rawOutput);
  assert.deepEqual(write.bytes, Buffer.from(rawOutput, 'utf8'));
  assert.equal(receipt.rawOutputArtifact.sha256, sha256(rawOutput));
  assert.equal(receipt.rawOutputArtifact.byteLength, Buffer.byteLength(rawOutput));
  assert.equal(
    receipt.rawOutputArtifact.artifactRef,
    `memory://benchmark-raw/${sha256(rawOutput)}`
  );
  assert.equal(receipt.parse.status, 'valid');
  assert.equal(receipt.compile.status, 'valid');
  assert.deepEqual(receipt.outcome, { status: 'valid' });
  assert.equal(receipt.transport.finishReason, 'external-finish-reason');
  assert.deepEqual(receipt.transport.usage, {
    input: 3,
    output: 5,
    reasoning: 7
  });
  assert.deepEqual(receipt.transport.provenance, {
    externalTransportReceipt: 'opaque'
  });
  assert.equal(JSON.stringify(receipt).includes(rawOutput), false);
  assert.match(receipt.receiptSha256, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.runPlan.condition));
  assert.throws(() => {
    receipt.runPlan.condition.carrierIdentity = 'mutated';
  }, /read only|Cannot assign/u);
});

test('identical externally supplied inputs produce identical receipts', async () => {
  const first = await runBenchmarkDryRun({
    plan: plan(),
    ...validComponents()
  });
  const second = await runBenchmarkDryRun({
    plan: plan(),
    ...validComponents()
  });

  assert.deepEqual(second, first);
  assert.equal(second.receiptSha256, first.receiptSha256);
});

test('factor, condition, and raw-output changes remain comparison-visible', async () => {
  const baseline = await runBenchmarkDryRun({
    plan: plan(),
    ...validComponents()
  });
  const changedFactor = await runBenchmarkDryRun({
    plan: plan({
      factorAssignments: {
        ...plan().factorAssignments,
        values: false
      }
    }),
    ...validComponents()
  });
  const changedCondition = await runBenchmarkDryRun({
    plan: plan({
      condition: {
        ...plan().condition,
        carrierIdentity: 'different-external-carrier'
      }
    }),
    ...validComponents()
  });
  const changedRaw = await runBenchmarkDryRun({
    plan: plan(),
    ...validComponents({ rawOutput: '{"different":"bytes"}' })
  });

  assert.notEqual(changedFactor.receiptSha256, baseline.receiptSha256);
  assert.notEqual(changedCondition.receiptSha256, baseline.receiptSha256);
  assert.notEqual(changedRaw.receiptSha256, baseline.receiptSha256);
});

test('typed parse failures are recorded without compiling or repairing', async () => {
  let compileCalls = 0;
  const rawOutput = 'not repaired or wrapped';
  const stubEngine = createStubEngine({
    parseOutcome: {
      ok: false,
      failure: {
        class: FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING,
        ruleId: 'EXTERNAL_PARSE_RULE',
        fieldPath: '$',
        offendingValue: 'exact'
      }
    },
    compileOutcome: validArtifact('never')
  });
  const receipt = await runBenchmarkDryRun({
    plan: plan(),
    transport: createStubTransport({ ok: true, rawOutput }),
    engine: {
      ...stubEngine,
      parse: async ({ rawOutput: observed }) => {
        assert.equal(observed, rawOutput);
        return stubEngine.parse();
      },
      compile: async () => {
        compileCalls += 1;
        return validArtifact('never');
      }
    },
    artifactSink: createMemoryArtifactSink()
  });

  assert.equal(compileCalls, 0);
  assert.equal(receipt.parse.status, 'failed');
  assert.deepEqual(receipt.compile, { status: 'not-run' });
  assert.equal(receipt.outcome.phase, 'parse');
  assert.equal(
    receipt.outcome.failure.class,
    FAILURE_CLASSES.CONTRACT_MISUNDERSTANDING
  );
});

test('typed compile and transport failures retain their supplied classes', async () => {
  const compileFailure = await runBenchmarkDryRun({
    plan: plan(),
    transport: createStubTransport({ ok: true, rawOutput: '{}' }),
    engine: createStubEngine({
      parseOutcome: validArtifact('parsed'),
      compileOutcome: {
        ok: false,
        failure: {
          class: FAILURE_CLASSES.DETERMINISTIC_ENGINE_FAILURE,
          ruleId: 'EXTERNAL_COMPILE_RULE'
        }
      }
    }),
    artifactSink: createMemoryArtifactSink()
  });
  assert.equal(compileFailure.outcome.phase, 'compile');
  assert.equal(
    compileFailure.outcome.failure.class,
    FAILURE_CLASSES.DETERMINISTIC_ENGINE_FAILURE
  );

  const transportFailure = await runBenchmarkDryRun({
    plan: plan(),
    transport: createStubTransport({
      ok: false,
      rawOutput: new Uint8Array([0, 1, 2]),
      failure: {
        class: FAILURE_CLASSES.TRANSPORT_SERIALIZATION,
        ruleId: 'EXTERNAL_TRANSPORT_RULE'
      }
    }),
    engine: createStubEngine({
      parseOutcome: validArtifact('never'),
      compileOutcome: validArtifact('never')
    }),
    artifactSink: createMemoryArtifactSink()
  });
  assert.equal(transportFailure.outcome.phase, 'transport');
  assert.equal(
    transportFailure.outcome.failure.class,
    FAILURE_CLASSES.TRANSPORT_SERIALIZATION
  );
  assert.equal(transportFailure.rawOutputArtifact.byteLength, 3);
});

test('invalid failure classes and non-stub boundaries fail closed', async () => {
  const invalidFailureSink = createMemoryArtifactSink();
  await assert.rejects(() => runBenchmarkDryRun({
    plan: plan(),
    transport: createStubTransport({
      ok: false,
      failure: {
        class: 'invented_failure_class',
        ruleId: 'BAD'
      }
    }),
    engine: createStubEngine({
      parseOutcome: validArtifact('never'),
      compileOutcome: validArtifact('never')
    }),
    artifactSink: invalidFailureSink
  }), /normative typed failure class/);
  assert.deepEqual(invalidFailureSink.inspectWrites(), []);

  const invalidProvenanceSink = createMemoryArtifactSink();
  await assert.rejects(() => runBenchmarkDryRun({
    plan: plan(),
    transport: {
      boundary: 'live-provider',
      execute: async () => ({ ok: true, rawOutput: '{}' })
    },
    engine: createStubEngine({
      parseOutcome: validArtifact('parsed'),
      compileOutcome: validArtifact('compiled')
    }),
    artifactSink: createMemoryArtifactSink()
  }), /provider-free-stub-transport boundary/);

  await assert.rejects(() => runBenchmarkDryRun({
    plan: plan(),
    transport: createStubTransport({
      ok: true,
      rawOutput: '{}',
      provenance: {
        invalid: undefined
      }
    }),
    engine: createStubEngine({
      parseOutcome: validArtifact('parsed'),
      compileOutcome: validArtifact('compiled')
    }),
    artifactSink: invalidProvenanceSink
  }), /transport\.provenance\.invalid must be JSON data/);
  assert.deepEqual(invalidProvenanceSink.inspectWrites(), []);
});
