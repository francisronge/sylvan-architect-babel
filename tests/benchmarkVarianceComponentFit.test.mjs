import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVarianceComponentFitPlan,
  hashVarianceComponentFitData,
  runVarianceComponentFitDryRun
} from '../bench/varianceComponentFit.js';
import { createVarianceComponentFitterStub } from '../bench/stubs.js';

const inputData = [
  {
    observationId: 'observation-1',
    itemId: 'item-a',
    conditionId: 'condition-a',
    rerunId: 'rerun-1',
    raterId: 'rater-a',
    authorId: 'author-a',
    outcome: 1
  },
  {
    observationId: 'observation-2',
    itemId: 'item-b',
    conditionId: 'condition-a',
    rerunId: 'rerun-1',
    raterId: 'rater-b',
    authorId: 'author-b',
    outcome: 0
  }
];
const priorParameters = {
  componentScalePrior: {
    family: 'external-family',
    parameters: ['external', 2]
  }
};
const samplerConfiguration = {
  chains: 2,
  drawsPerChain: 2,
  warmupPerChain: 1,
  externallyChosenControl: 'opaque'
};

const plan = (overrides = {}) => ({
  fitId: 'fit-1',
  outcomeIdentity: 'external-binary-outcome',
  likelihoodIdentity: 'external-likelihood',
  modelFormula: 'external-formula',
  componentSpecifications: [
    {
      componentId: 'item',
      groupingFields: ['itemId'],
      effectIdentity: 'external-random-intercept'
    },
    {
      componentId: 'item-condition',
      groupingFields: ['itemId', 'conditionId'],
      effectIdentity: 'external-random-intercept'
    },
    {
      componentId: 'rerun',
      groupingFields: ['rerunId'],
      effectIdentity: 'external-random-intercept'
    },
    {
      componentId: 'rater',
      groupingFields: ['raterId'],
      effectIdentity: 'external-random-intercept'
    },
    {
      componentId: 'item-author',
      groupingFields: ['authorId'],
      effectIdentity: 'external-random-intercept'
    }
  ],
  priorSpecification: {
    specificationId: 'external-prior-specification',
    sourceRef: 'methods://prior/specification',
    parameters: priorParameters,
    parametersSha256: hashVarianceComponentFitData(priorParameters)
  },
  samplerSpecification: {
    samplerId: 'external-sampler',
    implementationRef: 'methods://sampler/implementation',
    configuration: samplerConfiguration,
    configurationSha256: hashVarianceComponentFitData(samplerConfiguration)
  },
  inputDataSchemaRef: 'schema://variance-components/input-v1',
  inputDataSha256: hashVarianceComponentFitData(inputData),
  provenance: {
    designRef: 'external-design',
    methodApprovalRef: 'external-method-approval'
  },
  ...overrides
});

const fitBindings = () => ({
  planSha256: createVarianceComponentFitPlan(plan()).planSha256,
  inputDataSha256: hashVarianceComponentFitData(inputData)
});

const fittedOutcome = () => ({
  status: 'fitted',
  ...fitBindings(),
  execution: {
    executionId: 'execution-1',
    implementationIdentity: 'external-local-fitter',
    implementationSourceRef: 'source://fitter/commit',
    environmentIdentity: 'external-runtime-lock',
    seedIdentity: 'external-seed-identity'
  },
  posteriorDraws: [
    {
      drawId: 'chain-a-draw-0',
      chainId: 'chain-a',
      drawIndex: 0,
      components: {
        item: 0.4,
        'item-condition': 0.2,
        rerun: 0.1,
        rater: 0.3,
        'item-author': 0.05
      }
    },
    {
      drawId: 'chain-b-draw-0',
      chainId: 'chain-b',
      drawIndex: 0,
      components: {
        item: 0.5,
        'item-condition': 0.25,
        rerun: 0.15,
        rater: 0.35,
        'item-author': 0.08
      }
    }
  ],
  diagnostics: {
    externalRHat: { maximum: 1.01 },
    externalEffectiveSampleSize: { minimum: 500 }
  },
  provenance: {
    fitLogRef: 'artifact://fit/log'
  }
});

test('fit plans hash-bind external data, priors, sampler configuration, and components', () => {
  const result = createVarianceComponentFitPlan(plan());
  assert.equal(result.componentSpecifications.length, 5);
  assert.equal(result.priorSpecification.parametersSha256, hashVarianceComponentFitData(priorParameters));
  assert.match(result.planSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.componentSpecifications));
});

test('provider-free fits return complete immutable posterior-draw receipts', async () => {
  const receipt = await runVarianceComponentFitDryRun({
    plan: plan(),
    inputData,
    fitter: createVarianceComponentFitterStub(fittedOutcome())
  });
  assert.equal(receipt.posterior.status, 'available');
  assert.equal(receipt.posterior.drawCount, 2);
  assert.equal(receipt.posterior.draws[0].components.item, 0.4);
  assert.match(receipt.posterior.drawsSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.receiptSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(receipt));
  assert.ok(Object.isFrozen(receipt.posterior.draws[0].components));
});

test('input, prior, and sampler hash tampering fails before fitting', async () => {
  let fitCalls = 0;
  const fitter = {
    ...createVarianceComponentFitterStub(fittedOutcome()),
    fit: async () => {
      fitCalls += 1;
      return fittedOutcome();
    }
  };
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan(),
      inputData: [...inputData, { ...inputData[0], observationId: 'extra' }],
      fitter
    }),
    /inputData does not match/
  );
  assert.throws(
    () => createVarianceComponentFitPlan(plan({
      priorSpecification: {
        ...plan().priorSpecification,
        parameters: { changed: true }
      }
    })),
    /parameters does not match/
  );
  assert.throws(
    () => createVarianceComponentFitPlan(plan({
      samplerSpecification: {
        ...plan().samplerSpecification,
        configuration: { changed: true }
      }
    })),
    /configuration does not match/
  );
  assert.equal(fitCalls, 0);
});

test('posterior draws require every declared component and stable coordinates', async () => {
  const missingComponent = fittedOutcome();
  delete missingComponent.posteriorDraws[0].components.rater;
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan(),
      inputData,
      fitter: createVarianceComponentFitterStub(missingComponent)
    }),
    /missing=\[rater\]/
  );

  const duplicateCoordinate = fittedOutcome();
  duplicateCoordinate.posteriorDraws[1].chainId = 'chain-a';
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan(),
      inputData,
      fitter: createVarianceComponentFitterStub(duplicateCoordinate)
    }),
    /unique chainId\/drawIndex/
  );
});

test('component variances must remain finite and non-negative', async () => {
  const negative = fittedOutcome();
  negative.posteriorDraws[0].components.item = -1;
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan(),
      inputData,
      fitter: createVarianceComponentFitterStub(negative)
    }),
    /finite non-negative variance/
  );
  for (const invalid of [Infinity, NaN]) {
    const nonJson = fittedOutcome();
    nonJson.posteriorDraws[0].components.item = invalid;
    assert.throws(
      () => createVarianceComponentFitterStub(nonJson),
      /finite JSON data/
    );
  }
});

test('not-fitted outcomes preserve external failure identity without fabricated draws', async () => {
  const receipt = await runVarianceComponentFitDryRun({
    plan: plan(),
    inputData,
    fitter: createVarianceComponentFitterStub({
      status: 'not-fitted',
      ...fitBindings(),
      execution: fittedOutcome().execution,
      failureIdentity: 'external-nonconvergence',
      failureSourceRef: 'methods://fit/failure-taxonomy',
      details: { diagnosticRef: 'artifact://diagnostics/failed-fit' },
      provenance: { fitLogRef: 'artifact://fit/failed-log' }
    })
  });
  assert.equal(receipt.posterior.status, 'unavailable');
  assert.equal(receipt.posterior.failureIdentity, 'external-nonconvergence');
  assert.equal(receipt.posterior.draws, undefined);
  assert.equal(receipt.execution.executionId, 'execution-1');
});

test('non-stub fitters are refused before execution', async () => {
  let calls = 0;
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan(),
      inputData,
      fitter: {
        boundary: 'live-fitter',
        fit: async () => {
          calls += 1;
          return fittedOutcome();
        }
      }
    }),
    /provider-free-variance-component-fitter-stub/
  );
  assert.equal(calls, 0);
});

test('fitter outcomes must bind the exact plan and input hashes', async () => {
  for (const field of ['planSha256', 'inputDataSha256']) {
    const outcome = fittedOutcome();
    outcome[field] = '0'.repeat(64);
    await assert.rejects(
      runVarianceComponentFitDryRun({
        plan: plan(),
        inputData,
        fitter: createVarianceComponentFitterStub(outcome)
      }),
      /does not match/
    );
  }
});

test('identical inputs yield identical receipts without mutation', async () => {
  const first = await runVarianceComponentFitDryRun({
    plan: plan(),
    inputData,
    fitter: createVarianceComponentFitterStub(fittedOutcome())
  });
  const second = await runVarianceComponentFitDryRun({
    plan: plan(),
    inputData,
    fitter: createVarianceComponentFitterStub(fittedOutcome())
  });
  assert.deepEqual(first, second);
  assert.equal(inputData[0].outcome, 1);
  assert.equal(first.receiptSha256, second.receiptSha256);
});

test('input rows must expose every declared grouping field before fitting', async () => {
  let calls = 0;
  const malformedInput = structuredClone(inputData);
  delete malformedInput[0].raterId;
  await assert.rejects(
    runVarianceComponentFitDryRun({
      plan: plan({
        inputDataSha256: hashVarianceComponentFitData(malformedInput)
      }),
      inputData: malformedInput,
      fitter: {
        ...createVarianceComponentFitterStub(fittedOutcome()),
        fit: async () => {
          calls += 1;
          return fittedOutcome();
        }
      }
    }),
    /must contain grouping field raterId/
  );
  assert.equal(calls, 0);
});

test('stub construction snapshots outcomes against later mutation', async () => {
  const outcome = fittedOutcome();
  const fitter = createVarianceComponentFitterStub(outcome);
  outcome.posteriorDraws[0].components.item = 999;
  const receipt = await runVarianceComponentFitDryRun({
    plan: plan(),
    inputData,
    fitter
  });
  assert.equal(receipt.posterior.draws[0].components.item, 0.4);
});
