import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hashRaterEffectPropagationData,
  propagateRaterEffects
} from '../bench/raterEffectPropagation.js';

const scoreDraws = [
  { drawId: 'draw-a', value: 0.2 },
  { drawId: 'draw-b', value: 0.8 }
];
const raterEffectDraws = [
  { drawId: 'draw-b', signedEffect: -0.1 },
  { drawId: 'draw-a', signedEffect: 0.1 }
];
const plan = (overrides = {}) => ({
  propagationId: 'rater-effect-propagation-1',
  scoreIdentity: 'external-score-posterior',
  raterEffectIdentity: 'external-rater-effect-posterior',
  baseScoreRaterEffectTreatmentIdentity: 'rater-effect-excluded',
  baseScoreRaterEffectTreatmentSourceRef: 'methods://base-score-construction',
  combinationIdentity: 'paired-additive-signed-rater-effect-draws',
  drawPairingIdentity: 'exact-draw-id',
  jointDrawConstructionIdentity: 'joint-score-rater-effect-draws',
  jointDrawConstructionSourceRef: 'methods://joint-draw-construction',
  pointSummaryIdentity: 'equal-draw-arithmetic-mean',
  scaleCompatibilityIdentity: 'common-additive-scale',
  scaleCompatibilitySourceRef: 'methods://scale-compatibility',
  confidenceLevel: 0.95,
  confidenceLevelSourceRef: 's0://score-confidence',
  intervalType: 'percentile-order-statistics',
  scoreDrawsSourceRef: 'fit://score-draws',
  scoreDrawsSha256: hashRaterEffectPropagationData(scoreDraws),
  raterEffectDrawsSourceRef: 'fit://rater-effect-draws',
  raterEffectDrawsSha256: hashRaterEffectPropagationData(raterEffectDraws),
  lowerOrderIndex: 0,
  upperOrderIndex: 1,
  provenance: {
    modelRef: 'methods://externally-approved-rater-model'
  },
  ...overrides
});

test('draw-paired signed rater effects propagate without discarding covariance', () => {
  const receipt = propagateRaterEffects({
    plan: plan(),
    scoreDraws,
    raterEffectDraws
  });
  assert.deepEqual(receipt.pairedDraws, [
    {
      drawId: 'draw-a',
      scoreValue: 0.2,
      signedRaterEffect: 0.1,
      propagatedValue: 0.30000000000000004
    },
    {
      drawId: 'draw-b',
      scoreValue: 0.8,
      signedRaterEffect: -0.1,
      propagatedValue: 0.7000000000000001
    }
  ]);
  assert.deepEqual(receipt.baseScore.confidenceInterval, { low: 0.2, high: 0.8 });
  assert.deepEqual(
    receipt.propagatedScore.confidenceInterval,
    { low: 0.30000000000000004, high: 0.7000000000000001 }
  );
  assert.equal(receipt.baseScore.mean, 0.5);
  assert.equal(receipt.raterEffect.mean, 0);
  assert.equal(receipt.propagatedScore.mean, 0.5);
});

test('input order cannot break exact draw-ID pairing', () => {
  const reversedEffects = [...raterEffectDraws].reverse();
  const receipt = propagateRaterEffects({
    plan: plan({
      raterEffectDrawsSha256: hashRaterEffectPropagationData(reversedEffects)
    }),
    scoreDraws,
    raterEffectDraws: reversedEffects
  });
  assert.deepEqual(
    receipt.pairedDraws.map(({ drawId, signedRaterEffect }) => ({
      drawId,
      signedRaterEffect
    })),
    [
      { drawId: 'draw-a', signedRaterEffect: 0.1 },
      { drawId: 'draw-b', signedRaterEffect: -0.1 }
    ]
  );
});

test('plans require every external method identity and reject policy extras', () => {
  const missing = plan();
  delete missing.scaleCompatibilitySourceRef;
  assert.throws(
    () => propagateRaterEffects({
      plan: missing,
      scoreDraws,
      raterEffectDraws
    }),
    /missing=\[scaleCompatibilitySourceRef\]/
  );
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({ reliabilityThreshold: 0.6 }),
      scoreDraws,
      raterEffectDraws
    }),
    /extra=\[reliabilityThreshold\]/
  );
  for (const [field, value] of [
    ['baseScoreRaterEffectTreatmentIdentity', 'rater-effect-included'],
    ['combinationIdentity', 'independent-variance-sum'],
    ['drawPairingIdentity', 'array-position'],
    ['jointDrawConstructionIdentity', 'independently-sampled-draws'],
    ['pointSummaryIdentity', 'median'],
    ['scaleCompatibilityIdentity', 'incompatible-scales'],
    ['intervalType', 'normal']
  ]) {
    assert.throws(
      () => propagateRaterEffects({
        plan: plan({ [field]: value }),
        scoreDraws,
        raterEffectDraws
      }),
      new RegExp(`rater-effect propagation plan\\.${field} must be`)
    );
  }
});

test('source hashes reject changed score or rater-effect draws', () => {
  const changedScores = structuredClone(scoreDraws);
  changedScores[0].value = 0.3;
  assert.throws(
    () => propagateRaterEffects({
      plan: plan(),
      scoreDraws: changedScores,
      raterEffectDraws
    }),
    /scoreDraws do not match/
  );
  const changedEffects = structuredClone(raterEffectDraws);
  changedEffects[0].signedEffect = 0.2;
  assert.throws(
    () => propagateRaterEffects({
      plan: plan(),
      scoreDraws,
      raterEffectDraws: changedEffects
    }),
    /raterEffectDraws do not match/
  );
});

test('draw coverage and identities must match exactly', () => {
  const missingEffect = raterEffectDraws.slice(1);
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({
        raterEffectDrawsSha256: hashRaterEffectPropagationData(missingEffect)
      }),
      scoreDraws,
      raterEffectDraws: missingEffect
    }),
    /exactly matching drawId sets/
  );
  const unknownEffect = structuredClone(raterEffectDraws);
  unknownEffect[0].drawId = 'draw-z';
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({
        raterEffectDrawsSha256: hashRaterEffectPropagationData(unknownEffect)
      }),
      scoreDraws,
      raterEffectDraws: unknownEffect
    }),
    /exactly matching drawId sets/
  );
  const duplicateScore = structuredClone(scoreDraws);
  duplicateScore[1].drawId = 'draw-a';
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({
        scoreDrawsSha256: hashRaterEffectPropagationData(duplicateScore)
      }),
      scoreDraws: duplicateScore,
      raterEffectDraws
    }),
    /unique drawId/
  );
});

test('draw values and propagated sums must remain finite', () => {
  const hugeScores = [
    { drawId: 'draw-a', value: Number.MAX_VALUE },
    scoreDraws[1]
  ];
  const hugeEffects = [
    { drawId: 'draw-a', signedEffect: Number.MAX_VALUE },
    raterEffectDraws[0]
  ];
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({
        scoreDrawsSha256: hashRaterEffectPropagationData(hugeScores),
        raterEffectDrawsSha256: hashRaterEffectPropagationData(hugeEffects)
      }),
      scoreDraws: hugeScores,
      raterEffectDraws: hugeEffects
    }),
    /non-finite value/
  );
  assert.throws(
    () => hashRaterEffectPropagationData({ value: Number.NaN }),
    /must be finite JSON data/
  );

  const boundedExtremeScores = [
    { drawId: 'draw-a', value: -Number.MAX_VALUE },
    { drawId: 'draw-b', value: -Number.MAX_VALUE }
  ];
  const boundedExtremeEffects = [
    { drawId: 'draw-a', signedEffect: Number.MAX_VALUE },
    { drawId: 'draw-b', signedEffect: Number.MAX_VALUE }
  ];
  const receipt = propagateRaterEffects({
    plan: plan({
      scoreDrawsSha256: hashRaterEffectPropagationData(boundedExtremeScores),
      raterEffectDrawsSha256: hashRaterEffectPropagationData(boundedExtremeEffects)
    }),
    scoreDraws: boundedExtremeScores,
    raterEffectDraws: boundedExtremeEffects
  });
  assert.equal(receipt.baseScore.mean, -Number.MAX_VALUE);
  assert.equal(receipt.raterEffect.mean, Number.MAX_VALUE);
  assert.equal(receipt.propagatedScore.mean, 0);
});

test('confidence identity and order indices stay external and bounded', () => {
  for (const overrides of [
    { confidenceLevel: 1 },
    { lowerOrderIndex: -1 },
    { upperOrderIndex: scoreDraws.length },
    { lowerOrderIndex: 1, upperOrderIndex: 0 }
  ]) {
    assert.throws(
      () => propagateRaterEffects({
        plan: plan(overrides),
        scoreDraws,
        raterEffectDraws
      }),
      /confidenceLevel|must index|must not exceed/
    );
  }
});

test('one paired draw remains mechanical and makes no precision claim', () => {
  const oneScore = [scoreDraws[0]];
  const oneEffect = [raterEffectDraws[1]];
  const receipt = propagateRaterEffects({
    plan: plan({
      scoreDrawsSha256: hashRaterEffectPropagationData(oneScore),
      raterEffectDrawsSha256: hashRaterEffectPropagationData(oneEffect),
      lowerOrderIndex: 0,
      upperOrderIndex: 0
    }),
    scoreDraws: oneScore,
    raterEffectDraws: oneEffect
  });
  assert.equal(receipt.drawCount, 1);
  assert.equal(receipt.propagatedScore.mean, 0.30000000000000004);
  assert.equal(receipt.claimGrade, undefined);
  assert.equal(receipt.adopted, undefined);
});

test('identical inputs produce immutable receipts without caller mutation', () => {
  const planInput = plan();
  const scoreInput = structuredClone(scoreDraws);
  const effectInput = structuredClone(raterEffectDraws);
  const first = propagateRaterEffects({
    plan: planInput,
    scoreDraws: scoreInput,
    raterEffectDraws: effectInput
  });
  const second = propagateRaterEffects({
    plan: planInput,
    scoreDraws: scoreInput,
    raterEffectDraws: effectInput
  });
  assert.deepEqual(first, second);
  assert.equal(first.receiptSha256, second.receiptSha256);
  assert.equal(first.scoreDrawsSha256, hashRaterEffectPropagationData(scoreDraws));
  assert.equal(
    first.raterEffectDrawsSha256,
    hashRaterEffectPropagationData(raterEffectDraws)
  );
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.plan.provenance));
  assert.ok(Object.isFrozen(first.pairedDraws));
  assert.equal(scoreInput[0].value, 0.2);
  assert.equal(effectInput[0].drawId, 'draw-b');
});

test('non-JSON provenance fails before any receipt is produced', () => {
  assert.throws(
    () => propagateRaterEffects({
      plan: plan({ provenance: new Date() }),
      scoreDraws,
      raterEffectDraws
    }),
    /must be an object|plain JSON objects/
  );
});
