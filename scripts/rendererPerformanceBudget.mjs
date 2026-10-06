export const rendererPerformancePolicy = Object.freeze({
  samples: 5,
  relativeTolerance: 0.10,
  absoluteToleranceMs: 100,
  maxSpreadRatio: 0.25,
  referenceTargetMs: 2000
});

export function assessRendererPerformance(base, candidate, policy = rendererPerformancePolicy) {
  const summarize = (values) => {
    if (values.length !== policy.samples || values.some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Expected ${policy.samples} positive, finite opening times.`);
    }
    const sorted = [...values].sort((a, b) => a - b);
    const medianMs = sorted[Math.floor(sorted.length / 2)];
    return { samplesMs: values, medianMs, spreadRatio: (sorted.at(-1) - sorted[0]) / medianMs };
  };
  const before = summarize(base), after = summarize(candidate);
  const allowedIncreaseMs = Math.max(policy.absoluteToleranceMs, before.medianMs * policy.relativeTolerance);
  const increaseMs = after.medianMs - before.medianMs;
  const noisy = [before, after].some(sample => sample.spreadRatio > policy.maxSpreadRatio);
  return {
    status: noisy ? 'unstable' : increaseMs > allowedIncreaseMs ? 'regression' : 'passed',
    base: before, candidate: after, increaseMs, allowedIncreaseMs,
    referenceTargetMs: policy.referenceTargetMs
  };
}
