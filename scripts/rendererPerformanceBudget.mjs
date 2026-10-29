// CI runners stay cold past one warm-up (first measured samples 20-27% slow) and
// alternate between fast and slow phases, so two warm-up rounds are discarded and
// the median comes from seven alternating rounds.
export const rendererPerformancePolicy = Object.freeze({
  warmupRounds: 2,
  samples: 7,
  relativeTolerance: 0.10,
  absoluteToleranceMs: 100,
  maxSpreadRatio: 0.25,
  unstableRemeasures: 1,
  referenceTargetMs: 2000
});

/**
 * An unstable verdict means the runner was too noisy to judge, not that the
 * candidate is slow, so the check measures one fresh set of rounds and judges
 * that set alone. A regression or a pass is final: a slowdown never gets a
 * second measurement.
 */
export const shouldRemeasure = (assessment, attempts, policy = rendererPerformancePolicy) =>
  assessment.status === 'unstable' && attempts <= policy.unstableRemeasures;

function summarizeTimes(values, expectedSamples, allowZero = false) {
  if (values.length !== expectedSamples || values.some(value => !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))) {
    throw new Error(`Expected ${expectedSamples} ${allowZero ? 'nonnegative' : 'positive'}, finite timing samples.`);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const minMs = sorted[0], maxMs = sorted.at(-1);
  return { samplesMs: values, medianMs, minMs, maxMs, rangeMs: maxMs - minMs,
    spreadRatio: medianMs === 0 ? maxMs === 0 ? 0 : null : (maxMs - minMs) / medianMs };
}

export function assessRendererPerformance(base, candidate, policy = rendererPerformancePolicy) {
  const before = summarizeTimes(base, policy.samples), after = summarizeTimes(candidate, policy.samples);
  const allowedIncreaseMs = Math.max(policy.absoluteToleranceMs, before.medianMs * policy.relativeTolerance);
  const increaseMs = after.medianMs - before.medianMs;
  const noisy = [before, after].some(sample => sample.spreadRatio > policy.maxSpreadRatio);
  return {
    status: noisy ? 'unstable' : increaseMs > allowedIncreaseMs ? 'regression' : 'passed',
    base: before, candidate: after, increaseMs, allowedIncreaseMs,
    referenceTargetMs: policy.referenceTargetMs
  };
}

/** Preparation is measured independently; it has no calibrated blocking budget yet. */
export function describeRendererPreparation(base, candidate, policy = rendererPerformancePolicy) {
  const compare = (valuesBefore, valuesAfter, allowZero = false) => {
    const before = summarizeTimes(valuesBefore, policy.samples, allowZero);
    const after = summarizeTimes(valuesAfter, policy.samples, allowZero);
    const pairedDeltasMs = valuesAfter.map((value, index) => value - valuesBefore[index]);
    return { base: before, candidate: after, medianIncreaseMs: after.medianMs - before.medianMs, pairedDeltasMs,
      stable: [before, after].every(value => value.spreadRatio !== null && value.spreadRatio <= policy.maxSpreadRatio) };
  };
  return { measurementOnly: true, blockingBudget: null,
    complete: compare(base.map(sample => sample.completeMs), candidate.map(sample => sample.completeMs)),
    remainingAfterFirstPaint: compare(base.map(sample => Math.max(0, sample.completeMs - sample.readyMs)),
      candidate.map(sample => Math.max(0, sample.completeMs - sample.readyMs)), true) };
}
