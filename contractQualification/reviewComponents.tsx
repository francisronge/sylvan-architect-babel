import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import TreeVisualizer from '../components/TreeVisualizer';
import { buildDerivationCanvasData } from '../replay/replayCompiler';
import {
  changeReviewSelection, initialReviewSelection, reviewAnalyses, reviewStatus, reviewViews
} from './reviewModel.js';

const JsonEvidence = ({ value }: { value: unknown }) => <pre className="review-json">{JSON.stringify(value, null, 2)}</pre>;

class ReviewTreeBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  declare props: React.PropsWithChildren;
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error ? <div className="review-failure" role="alert">
      <strong>Live rendering failed.</strong>
      <p>{this.state.error.message}</p>
      <p>The archived outcome is unchanged. Raw records and diagnostics remain available.</p>
    </div> : this.props.children;
  }
}

export function ReviewTree({ choice, stage, mode, source = 'original' }: {
  choice: ReturnType<typeof reviewAnalyses>[number];
  stage?: Record<string, any>;
  mode: 'replay' | 'inspection';
  source?: string;
}) {
  // Renderer-owned annotations must never mutate the archived evidence shown in other views.
  const analysis = useMemo(() => source === 'copy'
    ? choice?.canInspectReplay ? structuredClone(choice.copyAnalysis) : null
    : choice?.canReplay ? structuredClone(choice.analysis) : null, [choice, source]);
  const forest = useMemo(() => Array.isArray(stage?.workspaceForest)
    ? structuredClone(stage.workspaceForest) : [], [stage]);
  if (mode === 'replay') return analysis
    ? <TreeVisualizer data={analysis.tree} animated derivationStages={analysis.derivationStages}
      sentence={source === 'copy' ? choice.copySentence : choice.sentence}
      inputTokens={source === 'copy' ? choice.copyInputTokens : choice.inputTokens} />
    : <p className="review-empty">No complete Replay was compiled for this analysis.</p>;
  const tree = buildDerivationCanvasData(forest);
  return tree ? <TreeVisualizer data={tree} /> : <p className="review-empty">{
    stage?.blockedByStageIndex !== undefined ? `Expansion blocked by stage ${stage.blockedByStageIndex + 1}.`
      : stage?.diagnostic ? 'Workspace could not be expanded.'
        : stage?.workspaceForest ? 'Empty workspace.' : 'No readable stages.'
  }</p>;
}

export function ReviewEvidence({ attempt, choice, view, runtime, runReceipt }: {
  attempt: Record<string, any>;
  choice?: ReturnType<typeof reviewAnalyses>[number];
  view: string;
  runtime?: unknown;
  runReceipt?: unknown;
}) {
  if (view === 'Raw response') {
    const raw = attempt.rawOutput;
    return <><p className="review-caption">Original saved response bytes. Encoding: {raw.encoding}. SHA-256: {raw.sha256}</p>
      {raw.matchesReceipt === false && <p className="review-failure">The saved bytes do not match the archived receipt hash.</p>}
      <pre className="review-json">{raw.encoding === 'utf8' ? raw.text : raw.base64}</pre></>;
  }
  if (view === 'Normalized record') return <>
    <p className="review-caption">Archived normalized derivative, not the original response. Normalization does not certify linguistic or visual correctness.</p>
    {attempt.normalizedRecord ? <JsonEvidence value={attempt.normalizedRecord} /> : <p className="review-empty">No normalized record was produced.</p>}
  </>;
  if (view === 'Diagnostics') return <JsonEvidence value={{
    ingress: attempt.receipt.ingress, outcome: attempt.outcome, inspection: attempt.inspection ?? null,
    renderer: choice?.archive?.evidence?.renderer ? {
      diagnostics: choice.archive.evidence.renderer.diagnostics,
      unregistered: choice.archive.evidence.renderer.unregistered
    } : null
  }} />;
  if (view === 'Corrections') return attempt.inspectionCopy ? <>
    <p className="review-caption">Inspection copy / recorded corrections. The original outcome remains {attempt.outcome.status}.</p>
    <JsonEvidence value={attempt.inspectionCopy} />
  </> : <p className="review-empty">No explicit inspection copy was supplied.</p>;
  if (view === 'Tier coverage') {
    const renderer = choice?.archive?.evidence?.renderer;
    return renderer ? <><p className="review-caption">Archived dispatch evidence, not certification of every rule or drawing.</p>
      <div className="review-metrics">{[1, 2, 3].map((tier) => <div key={tier}>
        <strong>{renderer.tierCounts[`tier${tier}`]}</strong><span>Tier {tier} claims</span>
      </div>)}</div><JsonEvidence value={renderer} /></>
      : <p className="review-empty">No archived renderer dispatch evidence.</p>;
  }
  if (view === 'Archived Replay') return <><p className="review-caption">Saved compilation evidence. Live Replay uses the renderer bundled with this review.</p>
    <JsonEvidence value={choice?.archive ?? null} /></>;
  return <JsonEvidence value={{ attempt: attempt.receipt, run: runReceipt, reviewRuntime: runtime }} />;
}

export function QualificationReview({ data }: { data: Record<string, any> }) {
  const attempts = data.attempts ?? [];
  const [selection, setSelection] = useState(() => initialReviewSelection(attempts));
  const attempt = attempts[selection.attempt];
  const choices = useMemo(() => attempt ? reviewAnalyses(attempt) : [], [attempt]);
  const choice = choices[selection.analysis];
  const stages = choice?.inspection?.stages ?? [];
  const stage = stages[selection.stage];
  const treeView = selection.view === 'Replay' || selection.view === 'Stage inspection';
  const change = (action: Parameters<typeof changeReviewSelection>[1]) => setSelection((current) => changeReviewSelection(current, action, attempts));
  if (!attempt) return <p className="review-empty">No archived attempts.</p>;
  const status = reviewStatus(attempt);
  const treeKey = `${selection.attempt}:${selection.analysis}:${selection.view}:${selection.source}`;
  return <main className="qualification-review">
    <header className="review-controls">
      <select className="review-select review-attempt" aria-label="Attempt" value={selection.attempt}
        onChange={(event) => change({ type: 'attempt', index: Number(event.target.value) })}>
        {attempts.map((entry, index) => <option key={index} value={index}>
          {entry.model?.label ?? entry.attemptId} / {entry.framework} / {entry.sentence}
        </option>)}
      </select>
      <select className="review-select" aria-label="Analysis" value={selection.analysis} disabled={!choices.length}
        onChange={(event) => change({ type: 'analysis', index: Number(event.target.value) })}>
        {choices.length ? choices.map((entry, index) => <option key={entry.analysisIndex} value={index}>Analysis {entry.analysisIndex + 1}</option>)
          : <option value={0}>No analysis</option>}
      </select>
      <select className="review-select" aria-label="View" value={selection.view}
        onChange={(event) => change({ type: 'view', view: event.target.value })}>
        {reviewViews.map((view) => <option key={view} value={view}>{view}</option>)}
      </select>
      {selection.view === 'Replay' && choice?.copyAnalysis && <select className="review-select"
        aria-label="Replay record" value={selection.source}
        onChange={(event) => change({ type: 'source', source: event.target.value })}>
        <option value="original">Original result</option>
        <option value="copy">Inspection copy</option>
      </select>}
      <span className={`review-status ${status.kind}`}>{status.label}</span>
      <span className="review-disposition">Linguistic: {attempt.inspection?.linguisticReviewStatus ?? 'unreviewed'}; visual: {attempt.inspection?.visualReviewStatus ?? 'unreviewed'}</span>
    </header>
    {treeView ? <>
      <div className="review-context">
        <span>{selection.view === 'Replay'
          ? selection.source === 'copy' ? 'Inspection copy / recorded corrections' : 'Live Replay / archived normalized derivative'
          : 'Inspection copy / stage only / Replay not compiled'}</span>
        {selection.view === 'Stage inspection' && <nav aria-label="Stage controls">
          <button title="Previous stage" aria-label="Previous stage" disabled={selection.stage === 0}
            onClick={() => change({ type: 'stage', index: selection.stage - 1 })}><ArrowLeft size={16} /></button>
          <select className="review-select" aria-label="Stage" value={selection.stage} disabled={!stages.length}
            onChange={(event) => change({ type: 'stage', index: Number(event.target.value) })}>
            {stages.length ? stages.map((entry, index) => <option key={entry.stageIndex} value={index}>Stage {entry.stageIndex + 1} / {stages.length}</option>)
              : <option value={0}>No stage</option>}
          </select>
          <button title="Next stage" aria-label="Next stage" disabled={selection.stage >= stages.length - 1}
            onClick={() => change({ type: 'stage', index: selection.stage + 1 })}><ArrowRight size={16} /></button>
        </nav>}
      </div>
      <section className="review-tree" aria-label={selection.view}>
        <ReviewTreeBoundary key={`${treeKey}:${selection.view === 'Stage inspection' ? selection.stage : ''}`}>
          <ReviewTree choice={choice} stage={stage} source={selection.source} mode={selection.view === 'Replay' ? 'replay' : 'inspection'} />
        </ReviewTreeBoundary>
      </section>
      {selection.view === 'Stage inspection' && <footer className="review-stage-evidence">
        <p>{typeof stage?.authoredStage?.statement === 'string' ? stage.authoredStage.statement : ''}</p>
        <details><summary>Inspection fields and diagnostics</summary><JsonEvidence value={{
          stage: stage ?? null, repairDiagnostics: attempt.inspection?.repairDiagnostics ?? [],
          rawOutput: attempt.inspection?.rawOutput
        }} /></details>
      </footer>}
    </> : <section className="review-evidence" aria-label={selection.view}>
      <ReviewEvidence attempt={attempt} choice={choice} view={selection.view} runtime={data.runtime} runReceipt={data.runReceipt} />
    </section>}
  </main>;
}
