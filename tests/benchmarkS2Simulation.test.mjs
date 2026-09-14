import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createS2SimulationPlan,
  hashS2SimulationData,
  runS2SimulationDryRun
} from '../bench/s2Simulation.js';
import { createS2SimulatorStub } from '../bench/stubs.js';

const posteriorDraws = [
  { drawId: 'draw-a', components: { item: 0.2, rerun: 0.1 } },
  { drawId: 'draw-b', components: { item: 0.3, rerun: 0.15 } }
];
const simulatorConfiguration = {
  estimatorIdentity: 'external-estimator',
  simulationRuleIdentity: 'external-rule'
};
const designs = [
  {
    candidateId: 'design-small',
    design: { items: 20, rerunsByClass: { default: 2 }, doubleRatingShare: 0.4 }
  },
  {
    candidateId: 'design-large',
    design: { items: 40, rerunsByClass: { default: 3 }, doubleRatingShare: 0.6 }
  }
].map((candidate) => ({
  ...candidate,
  designSha256: hashS2SimulationData(candidate.design)
}));

const posteriorFitBody = {
  schemaVersion: 1,
  posterior: {
    status: 'available',
    drawCount: posteriorDraws.length,
    drawsSha256: hashS2SimulationData(posteriorDraws),
    draws: posteriorDraws,
    diagnostics: { source: 'external-fit' }
  },
  provenance: { fitRef: 'fit://receipt' }
};
const posteriorFitReceipt = {
  ...posteriorFitBody,
  receiptSha256: hashS2SimulationData(posteriorFitBody)
};

const plan = (overrides = {}) => ({
  simulationId: 's2-simulation-1',
  posteriorFitReceiptSha256: posteriorFitReceipt.receiptSha256,
  posteriorDrawsSha256: hashS2SimulationData(posteriorDraws),
  posteriorSelection: {
    selectionId: 'external-middle-window-selection',
    sourceRef: 'methods://posterior-selection',
    drawIds: ['draw-a', 'draw-b']
  },
  designCandidates: designs,
  targetSpecifications: [
    {
      targetId: 'precision-target',
      metricId: 'halfWidth',
      comparator: 'at-most',
      threshold: 0.1,
      sourceRef: 's0://precision-target'
    },
    {
      targetId: 'power-target',
      metricId: 'power',
      comparator: 'at-least',
      threshold: 0.8,
      sourceRef: 's0://power-target'
    }
  ],
  simulatorSpecification: {
    simulatorId: 'external-s2-simulator',
    implementationRef: 'source://simulator/commit',
    configuration: simulatorConfiguration,
    configurationSha256: hashS2SimulationData(simulatorConfiguration)
  },
  executionSpecification: {
    executionId: 'execution-1',
    environmentIdentity: 'runtime-lock-1',
    randomScheduleIdentity: 'external-random-schedule',
    randomScheduleSourceRef: 'artifact://random-schedule'
  },
  provenance: {
    designPolicyRef: 's0://policy',
    methodApprovalRef: 'methods://approval'
  },
  ...overrides
});

const bindings = (candidate, drawId) => {
  const frozenPlan = createS2SimulationPlan(plan());
  return {
    simulationPlanSha256: frozenPlan.planSha256,
    posteriorDrawsSha256: frozenPlan.posteriorDrawsSha256,
    executionId: frozenPlan.executionSpecification.executionId,
    candidateId: candidate.candidateId,
    candidateDesignSha256: candidate.designSha256,
    drawId
  };
};

const simulatedCell = (candidate, drawId, metrics) => ({
  status: 'simulated',
  ...bindings(candidate, drawId),
  metrics,
  provenance: { simulationArtifactRef: `memory://${candidate.candidateId}/${drawId}` }
});

const completeResults = () => [
  simulatedCell(designs[0], 'draw-a', { halfWidth: 0.12, power: 0.75 }),
  simulatedCell(designs[0], 'draw-b', { halfWidth: 0.11, power: 0.78 }),
  simulatedCell(designs[1], 'draw-a', { halfWidth: 0.09, power: 0.82 }),
  simulatedCell(designs[1], 'draw-b', { halfWidth: 0.08, power: 0.85 })
];

const runInput = (overrides = {}) => ({
  plan: plan(),
  posteriorFitReceipt,
  posteriorDraws,
  ...overrides
});

test('plans preserve every external design, target, posterior, and execution choice', () => {
  const result = createS2SimulationPlan(plan());
  assert.equal(result.designCandidates[0].design.items, 20);
  assert.equal(result.targetSpecifications[0].threshold, 0.1);
  assert.equal(result.posteriorSelection.drawIds.length, 2);
  assert.match(result.planSha256, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.designCandidates[0].design));
});

test('all candidate/draw cells are evaluated without selecting a winner', async () => {
  const receipt = await runS2SimulationDryRun({
    ...runInput(),
    simulator: createS2SimulatorStub(completeResults())
  });
  assert.equal(receipt.cells.length, 4);
  assert.deepEqual(
    receipt.candidateSummaries.map(({ candidateId, allDeclaredTargetsSatisfied }) => ({
      candidateId,
      allDeclaredTargetsSatisfied
    })),
    [
      { candidateId: 'design-small', allDeclaredTargetsSatisfied: false },
      { candidateId: 'design-large', allDeclaredTargetsSatisfied: true }
    ]
  );
  assert.equal(receipt.selectedCandidateId, undefined);
  assert.ok(Object.isFrozen(receipt.cells[0].targetEvaluations));
});

test('target comparators are mechanical and externally thresholded', async () => {
  const receipt = await runS2SimulationDryRun({
    ...runInput(),
    simulator: createS2SimulatorStub(completeResults())
  });
  const large = receipt.candidateSummaries[1];
  assert.equal(large.targetSummaries[0].satisfiedDrawCount, 2);
  assert.equal(large.targetSummaries[1].satisfiedDrawCount, 2);
  assert.equal(large.targetSummaries[0].allSelectedDrawsSatisfy, true);
});

test('simulator coverage must equal the complete candidate/draw cross-product', async () => {
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      simulator: createS2SimulatorStub(completeResults().slice(0, 3))
    }),
    /cover every planned candidate\/draw cell/
  );
  assert.throws(
    () => createS2SimulatorStub([
      completeResults()[0],
      completeResults()[0]
    ]),
    /unique candidate\/draw cells/
  );
});

test('cell bindings reject plan, design, draw, and execution tampering', async () => {
  for (const [field, value] of [
    ['simulationPlanSha256', '0'.repeat(64)],
    ['candidateDesignSha256', '0'.repeat(64)],
    ['drawId', 'draw-z'],
    ['executionId', 'wrong-execution']
  ]) {
    const results = completeResults();
    results[0][field] = value;
    await assert.rejects(
      runS2SimulationDryRun({
        ...runInput(),
        simulator: createS2SimulatorStub(results)
      }),
      /does not match|cover every planned/
    );
  }
});

test('not-simulated cells preserve failure evidence and make a candidate incomplete', async () => {
  const results = completeResults();
  results[3] = {
    status: 'not-simulated',
    ...bindings(designs[1], 'draw-b'),
    failureIdentity: 'external-numerical-failure',
    failureSourceRef: 'methods://simulation-failures',
    details: { logRef: 'artifact://simulation/failure' },
    provenance: { simulationArtifactRef: 'memory://failed-cell' }
  };
  const receipt = await runS2SimulationDryRun({
    ...runInput(),
    simulator: createS2SimulatorStub(results)
  });
  assert.equal(receipt.candidateSummaries[1].status, 'incomplete');
  assert.equal(receipt.candidateSummaries[1].allDeclaredTargetsSatisfied, null);
  assert.equal(receipt.cells[3].failureIdentity, 'external-numerical-failure');
});

test('posterior and configuration hashes reject tampering before simulation', async () => {
  let calls = 0;
  const simulator = {
    ...createS2SimulatorStub(completeResults()),
    simulate: async () => {
      calls += 1;
      return completeResults()[0];
    }
  };
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      posteriorDraws: [...posteriorDraws, { drawId: 'extra' }],
      simulator
    }),
    /posteriorDraws does not match/
  );
  assert.throws(
    () => createS2SimulationPlan(plan({
      simulatorSpecification: {
        ...plan().simulatorSpecification,
        configuration: { changed: true }
      }
    })),
    /configuration does not match/
  );
  assert.equal(calls, 0);
});

test('posterior fit receipts must reconstruct and expose available bound draws', async () => {
  const tampered = structuredClone(posteriorFitReceipt);
  tampered.provenance.fitRef = 'fit://tampered';
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      posteriorFitReceipt: tampered,
      simulator: createS2SimulatorStub(completeResults())
    }),
    /fails canonical reconstruction/
  );

  const internallyMismatchedBody = structuredClone(posteriorFitBody);
  internallyMismatchedBody.posterior.draws[0].components.item = 999;
  const internallyMismatched = {
    ...internallyMismatchedBody,
    receiptSha256: hashS2SimulationData(internallyMismatchedBody)
  };
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      plan: plan({
        posteriorFitReceiptSha256: internallyMismatched.receiptSha256
      }),
      posteriorFitReceipt: internallyMismatched,
      simulator: createS2SimulatorStub(completeResults())
    }),
    /posterior\.draws does not match/
  );

  const unavailableBody = {
    ...posteriorFitBody,
    posterior: {
      status: 'unavailable',
      drawsSha256: hashS2SimulationData(posteriorDraws),
      draws: posteriorDraws
    }
  };
  const unavailable = {
    ...unavailableBody,
    receiptSha256: hashS2SimulationData(unavailableBody)
  };
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      plan: plan({
        posteriorFitReceiptSha256: unavailable.receiptSha256
      }),
      posteriorFitReceipt: unavailable,
      simulator: createS2SimulatorStub(completeResults())
    }),
    /must contain an available posterior/
  );
});

test('unknown posterior selections and malformed target policies fail closed', async () => {
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      plan: plan({
        posteriorSelection: {
          ...plan().posteriorSelection,
          drawIds: ['draw-z']
        }
      }),
      simulator: createS2SimulatorStub(completeResults())
    }),
    /is not in posteriorDraws/
  );
  assert.throws(
    () => createS2SimulationPlan(plan({
      targetSpecifications: [{
        ...plan().targetSpecifications[0],
        comparator: 'closest'
      }]
    })),
    /must be one of/
  );
});

test('non-stub simulators are refused before processing posterior draws', async () => {
  let calls = 0;
  await assert.rejects(
    runS2SimulationDryRun({
      ...runInput(),
      posteriorDraws: 'not-even-an-array',
      simulator: {
        boundary: 'live-simulator',
        listCellKeys: () => [],
        simulate: async () => {
          calls += 1;
        }
      }
    }),
    /provider-free-s2-simulator-stub/
  );
  assert.equal(calls, 0);
});

test('identical inputs produce identical immutable receipts without mutation', async () => {
  const run = () => runS2SimulationDryRun({
    ...runInput(),
    simulator: createS2SimulatorStub(completeResults())
  });
  const first = await run();
  const second = await run();
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(posteriorDraws[0].components.item, 0.2);
  assert.equal(designs[0].design.items, 20);
});
