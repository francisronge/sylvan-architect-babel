import React, { useEffect, useMemo, useState } from 'react';
import AsyncTreeVisualizer from './AsyncTreeVisualizer';
import ViewErrorBoundary from './ViewErrorBoundary';
import type { ParseFailure, RawOutputArtifact } from '../types';
import { buildDerivationCanvasData } from '../replay/replayCompiler';
import { inspectionStageDisplay } from '../replay/diagnosticReplay';
import { drawableInspectionForest, inspectFailedOutput, type FailedOutputInspection as InspectionRecord } from '../services/failedOutputInspection';

interface Props {
  rawOutput: RawOutputArtifact;
  failure?: ParseFailure;
  sentence?: string;
  inputTokens?: string[];
}

const InspectionContents: React.FC<{ record: InspectionRecord; failure?: ParseFailure; sentence?: string; inputTokens?: string[] }> = ({ record, failure, sentence, inputTokens }) => {
  const [analysisIndex, setAnalysisIndex] = useState(Math.min(failure?.analysisIndex ?? 0, Math.max(0, record.analyses.length - 1)));
  const analysis = record.analyses[analysisIndex];
  const stages = analysis?.stages ?? [];
  const [stageIndex, setStageIndex] = useState(Math.min(failure?.stageIndex ?? 0, Math.max(0, stages.length - 1)));
  const [view, setView] = useState<'stage' | 'replay'>('stage');
  const stage = stages[stageIndex];
  const display = useMemo(() => inspectionStageDisplay(drawableInspectionForest(stage?.workspaceForest ?? null)), [stage]);
  const stageTree = useMemo(() => buildDerivationCanvasData(display.forest), [display]);
  const replayTree = useMemo(() => buildDerivationCanvasData(analysis?.replayStages?.at(-1)?.workspaceForest ?? []), [analysis]);
  const authored = stage?.authoredStage && typeof stage.authoredStage === 'object'
    ? stage.authoredStage as Record<string, unknown> : {};
  const viewKey = `${analysisIndex}:${view}:${view === 'stage' ? stageIndex : ''}`;

  return <div className="space-y-3 text-emerald-100">
    <p className="text-xs leading-relaxed">Diagnostic inspection of a failed response. These stages have not been accepted as a valid analysis. The original output and failure remain unchanged.</p>
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-xs">Analysis
        <select aria-label="Failed output analysis" value={analysisIndex} className="rounded-lg border border-emerald-500/30 bg-emerald-950 px-2 py-2"
          onChange={event => { setAnalysisIndex(Number(event.target.value)); setStageIndex(0); setView('stage'); }}>
          {record.analyses.map(entry => <option key={entry.analysisIndex} value={entry.analysisIndex}>Analysis {entry.analysisIndex + 1}</option>)}
        </select>
      </label>
      <div className="flex gap-2" role="group" aria-label="Failed output inspection view">
        <button type="button" aria-pressed={view === 'stage'} onClick={() => setView('stage')}
          className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs aria-pressed:bg-emerald-800">Stages</button>
        <button type="button" aria-pressed={view === 'replay'} disabled={!analysis?.replayStages || !replayTree} onClick={() => setView('replay')}
          className="rounded-lg border border-emerald-500/30 px-3 py-2 text-xs aria-pressed:bg-emerald-800 disabled:opacity-40">Diagnostic Replay</button>
      </div>
      {view === 'stage' && stages.length > 0 && <label className="flex items-center gap-2 text-xs">Stage
        <select aria-label="Failed output stage" value={stageIndex} className="rounded-lg border border-emerald-500/30 bg-emerald-950 px-2 py-2"
          onChange={event => setStageIndex(Number(event.target.value))}>
          {stages.map((entry, index) => <option key={entry.stageIndex} value={index}>Stage {entry.stageIndex + 1} / {stages.length}{entry.diagnostics.length ? ' · diagnostics' : ''}</option>)}
        </select>
      </label>}
    </div>
    {analysis?.replayIssue && <p className="text-xs text-amber-200">{analysis.replayIssue}</p>}
    {view === 'stage' && display.duplicateIds.length > 0 && <p className="text-xs text-amber-200">
      Duplicate authored IDs: {display.duplicateIds.join(', ')}. Every occurrence is shown with a separate drawing identity; no authored ID was changed.
    </p>}
    {view === 'replay' && analysis.duplicateIdentityCount > 0 && <p className="text-xs text-amber-200">
      Repeated authored IDs use separate drawing identities. {analysis.ambiguousRelationCount > 0
        ? `${analysis.ambiguousRelationCount} relations have ambiguous targets and remain neutral; no target was guessed.`
        : 'The original occurrence IDs and syntax remain unchanged.'}
    </p>}
    <div className="h-[65vh] min-h-[360px] overflow-hidden rounded-xl border border-emerald-500/20 bg-emerald-950/30" aria-label={view === 'stage' ? 'Failed output workspace' : 'Failed output diagnostic Replay'}>
      <ViewErrorBoundary resetKey={viewKey} title="This diagnostic view could not be drawn."
        message="The original failure, output, and stage details are still available.">
        {view === 'replay' && analysis.replayStages && replayTree
          ? <AsyncTreeVisualizer key={viewKey} data={replayTree} animated autoPlay={false} derivationStages={analysis.replayStages} sentence={sentence} inputTokens={inputTokens} />
          : stageTree
            ? <AsyncTreeVisualizer key={viewKey} data={stageTree} sentence={sentence} />
            : <p className="p-5 text-sm">{stage?.drawingIssue ?? (stage?.blockedByStageIndex !== undefined
              ? `This workspace depends on an unreadable stage ${stage.blockedByStageIndex + 1}.`
              : stage?.workspaceForest?.length === 0 ? 'This authored workspace is empty.' : 'This stage cannot be drawn. Its original fields and diagnostics are below.')}</p>}
      </ViewErrorBoundary>
    </div>
    {view === 'stage' && <div className="space-y-2 text-xs leading-relaxed">
      {typeof authored.statement === 'string' && <p className="font-bold">{authored.statement}</p>}
      {typeof authored.stageRecord === 'string' && <p className="whitespace-pre-wrap">{authored.stageRecord}</p>}
    </div>}
    <details className="rounded-xl border border-emerald-500/20 bg-black/20 p-3">
      <summary className="cursor-pointer text-xs font-bold">Original fields and inspection diagnostics</summary>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px]">{JSON.stringify(view === 'stage'
        ? { authoredStage: stage?.authoredStage ?? null, diagnostics: stage?.diagnostics ?? [], drawingIssue: stage?.drawingIssue }
        : { authoredAnalysis: analysis?.authoredAnalysis, stages: stages.map(entry => ({ stageIndex: entry.stageIndex, diagnostics: entry.diagnostics })) }, null, 2)}</pre>
    </details>
  </div>;
};

const FailedOutputInspection: React.FC<Props> = ({ rawOutput, failure, sentence, inputTokens }) => {
  const [result, setResult] = useState<{ record?: InspectionRecord; error?: string } | null>(null);
  useEffect(() => {
    let active = true;
    setResult(null);
    inspectFailedOutput(rawOutput, sentence, inputTokens).then(record => {
      if (active) setResult({ record });
    }, error => { if (active) setResult({ error: error instanceof Error ? error.message : 'This output could not be inspected.' }); });
    return () => { active = false; };
  }, [rawOutput, sentence, inputTokens]);
  if (!result) return <p role="status" className="text-xs text-emerald-200">Reading the retained output…</p>;
  if (result.error) return <p role="status" className="text-xs text-amber-200">{result.error}</p>;
  return <InspectionContents record={result.record!} failure={failure} sentence={sentence} inputTokens={inputTokens} />;
};

export default FailedOutputInspection;
