export const reviewViews = [
  'Replay', 'Stage inspection', 'Raw response', 'Normalized record',
  'Diagnostics', 'Corrections', 'Tier coverage', 'Archived Replay', 'Receipt'
];

export const reviewStatus = (attempt) => {
  if (attempt.outcome?.status === 'failed') return { label: 'Failed', kind: 'failed' };
  const repaired = (attempt.receipt?.ingress?.repairDiagnostics ?? []).length > 0;
  return repaired
    ? { label: 'Normalized after repair', kind: 'repaired' }
    : { label: 'Normalized', kind: 'normalized' };
};

export const reviewAnalyses = (attempt) => {
  const bundle = attempt.normalizedRecord?.response ?? attempt.normalizedRecord;
  const copy = attempt.inspectionCopy?.bundle?.response ?? attempt.inspectionCopy?.bundle;
  const indices = new Set([
    ...(attempt.analyses ?? []).map(({ analysisIndex }) => analysisIndex),
    ...(bundle?.analyses ?? []).map((_, index) => index),
    ...(copy?.analyses ?? []).map((_, index) => index),
    ...(attempt.inspection?.analyses ?? []).map(({ analysisIndex }) => analysisIndex)
  ]);
  return [...indices].sort((left, right) => left - right).map((analysisIndex) => {
    const analysis = bundle?.analyses?.[analysisIndex] ?? null;
    const archive = attempt.analyses?.find((entry) => entry.analysisIndex === analysisIndex) ?? null;
    const inspection = attempt.inspection?.analyses?.find((entry) => entry.analysisIndex === analysisIndex) ?? null;
    const copyAnalysis = copy?.analyses?.[analysisIndex] ?? null;
    return {
      analysisIndex, analysis, archive, inspection, copyAnalysis,
      sentence: bundle?.sentence ?? attempt.sentence ?? '',
      inputTokens: bundle?.inputTokens,
      copySentence: copy?.sentence ?? attempt.sentence ?? '',
      copyInputTokens: copy?.inputTokens,
      canInspectReplay: Boolean((copyAnalysis?.tree || copyAnalysis?.finalForest?.length) && copyAnalysis?.derivationStages?.length),
      canReplay: attempt.outcome?.status !== 'failed'
        && Boolean(archive?.replay && (analysis?.tree || analysis?.finalForest?.length) && analysis?.derivationStages?.length)
    };
  });
};

const initialChoiceView = (choice) => choice?.canReplay || choice?.canInspectReplay
  ? 'Replay' : choice?.inspection?.stages?.length ? 'Stage inspection' : 'Diagnostics';

const availableView = (view, choice) => {
  const unavailable = view === 'Replay' && !choice?.canReplay && !choice?.canInspectReplay
    || view === 'Stage inspection' && !choice?.inspection?.stages?.length;
  return unavailable ? initialChoiceView(choice) : view;
};

const initialView = (attempt) => initialChoiceView(reviewAnalyses(attempt)[0]);

const initialSource = (choice) => !choice?.canReplay && choice?.canInspectReplay ? 'copy' : 'original';

export const initialReviewSelection = (attempts) => ({
  attempt: 0, analysis: 0, stage: 0, view: attempts[0] ? initialView(attempts[0]) : 'Diagnostics',
  source: initialSource(attempts[0] ? reviewAnalyses(attempts[0])[0] : null)
});

export const changeReviewSelection = (selection, action, attempts) => {
  if (action.type === 'attempt') return {
    attempt: action.index, analysis: 0, stage: 0, view: initialView(attempts[action.index]),
    source: initialSource(reviewAnalyses(attempts[action.index])[0])
  };
  if (action.type === 'analysis') {
    const choice = reviewAnalyses(attempts[selection.attempt])[action.index];
    return { ...selection, analysis: action.index, stage: 0,
      view: availableView(selection.view, choice), source: initialSource(choice) };
  }
  if (action.type === 'stage') return { ...selection, stage: action.index };
  if (action.type === 'view') return { ...selection,
    view: availableView(action.view, reviewAnalyses(attempts[selection.attempt])[selection.analysis]) };
  if (action.type === 'source') return { ...selection, source: action.source };
  return selection;
};
