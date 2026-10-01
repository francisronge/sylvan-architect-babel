import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import TreeVisualizer from '../components/TreeVisualizer';
import { buildDerivationCanvasData } from '../replay/replayCompiler';
import { prepareReplay } from '../replay/prepareReplay';
import type { SyntaxNode } from '../types';
import { diagnosticReplayStages, duplicateStageNodeIds, inspectionStageDisplay } from './diagnosticReplay';
import { InspectionIdentityNotice } from './InspectionIdentityNotice';
import '../styles.css';
import './workspaceInspection.css';

interface Inspection {
  title: string;
  record: {
    kind: 'authored-workspace-inspection';
    rawOutput: { sha256: string };
    repairDiagnostics: unknown[];
    payload: unknown;
    input?: { sentence: string; tokens: string[] };
    analyses: Array<{
      analysisIndex: number;
      realizationReplayDiagnostics?: string[];
      stages: Array<{
        stageIndex: number;
        authoredStage: unknown;
        workspaceForest: SyntaxNode[] | null;
        diagnostic?: unknown;
        diagnostics?: unknown[];
        blockedByStageIndex?: number;
      }> | null;
    }>;
  };
}

function WorkspaceInspection({ records }: { records: Inspection[] }) {
  const [selection, setSelection] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const [requestedView, setView] = useState<'replay' | 'stage'>('replay');
  const choices = useMemo(() => records.flatMap(({ title, record }) => record.analyses.map((analysis) => ({
    title: `${title} / Analysis ${analysis.analysisIndex + 1}`, record, analysis
  }))), [records]);
  const selected = choices[selection];
  const stages = selected?.analysis.stages ?? [];
  const stage = stages[stageIndex];
  const display = useMemo(() => inspectionStageDisplay(stage?.workspaceForest), [stage]);
  const tree = useMemo(() => buildDerivationCanvasData(display.forest), [display]);
  const replayStages = useMemo(() => diagnosticReplayStages(stages), [stages]);
  const replayTree = useMemo(() => buildDerivationCanvasData(replayStages?.at(-1)?.workspaceForest ?? []), [replayStages]);
  const diagnosticReplay = useMemo(() => {
    if (!replayStages || !replayTree) return null;
    try {
      return prepareReplay({ derivationStages: replayStages, sentence: selected?.record.input?.sentence ?? '',
        inputTokens: selected?.record.input?.tokens, includePlayback: true });
    } catch {
      return null;
    }
  }, [replayStages, replayTree, selected]);
  const view = requestedView === 'replay' && !diagnosticReplay ? 'stage' : requestedView;
  const authored = stage?.authoredStage && typeof stage.authoredStage === 'object'
    ? stage.authoredStage as Record<string, unknown> : {};

  return <main className="workspace-inspection">
    <header>
      <span>Unvalidated model output</span>
      <select aria-label="Analysis" value={selection} onChange={(event) => {
        setSelection(Number(event.target.value)); setStageIndex(0);
      }}>
        {choices.map((choice, index) => <option key={index} value={index}>{choice.title}</option>)}
      </select>
      <div className="inspection-view-controls" role="group" aria-label="Inspection view">
        <button type="button" aria-pressed={view === 'replay'} disabled={!diagnosticReplay}
          onClick={() => setView('replay')}>Replay</button>
        <button type="button" aria-pressed={view === 'stage'} onClick={() => setView('stage')}>Stages</button>
      </div>
      {view === 'stage' && <nav aria-label="Stage controls">
        <button title="Previous stage" aria-label="Previous stage" disabled={stageIndex === 0}
          onClick={() => setStageIndex(stageIndex - 1)}><ArrowLeft size={18} /></button>
        <select aria-label="Stage" value={stageIndex} disabled={!stages.length}
          onChange={(event) => setStageIndex(Number(event.target.value))}>
          {stages.map((entry, index) => <option key={entry.stageIndex} value={index}>Stage {entry.stageIndex + 1} / {stages.length}{duplicateStageNodeIds(entry.workspaceForest).length ? ' · duplicate IDs' : ''}</option>)}
        </select>
        <button title="Next stage" aria-label="Next stage" disabled={stageIndex >= stages.length - 1}
          onClick={() => setStageIndex(stageIndex + 1)}><ArrowRight size={18} /></button>
      </nav>}
    </header>
    <section className="inspection-tree" aria-label={view === 'replay' ? 'Diagnostic Replay' : 'Authored workspace'}
      data-stage-index={stageIndex} data-inspection-view={view}>
      {view === 'replay' && replayTree && replayStages && diagnosticReplay ? (
        <TreeVisualizer key={`replay:${selection}`} data={replayTree} animated autoPlay={false}
          preparedReplay={diagnosticReplay} derivationStages={replayStages} sentence={selected?.record.input?.sentence}
          inputTokens={selected?.record.input?.tokens} />
      ) : view === 'replay' ? (
        <p>Replay cannot be built from these stages. Select Stages to inspect the saved workspace and diagnostics.</p>
      ) : tree ? <div className="inspection-stage-layout">
        <InspectionIdentityNotice display={display} />
        <div className="inspection-stage-canvas"><TreeVisualizer key={`stage:${selection}:${stageIndex}`} data={tree} sentence={selected?.record.input?.sentence} /></div>
      </div>
        : <p>{stage?.blockedByStageIndex !== undefined
          ? `Expansion blocked by stage ${stage.blockedByStageIndex + 1}.`
          : stage?.diagnostic ? 'Workspace could not be expanded.'
            : stage?.workspaceForest ? 'Empty workspace.' : 'No readable stages.'}</p>}
    </section>
    {view === 'stage' && <footer>
      <h1>{typeof authored.statement === 'string' ? authored.statement : `Stage ${stageIndex + 1}`}</h1>
      <p>{typeof authored.stageRecord === 'string' ? authored.stageRecord : ''}</p>
      <details><summary>Original fields and diagnostics</summary><pre>{JSON.stringify({
        rawOutput: selected?.record.rawOutput,
        input: selected?.record.input,
        repairDiagnostics: selected?.record.repairDiagnostics,
        authoredStage: stage?.authoredStage,
        diagnostic: stage?.diagnostic,
        diagnostics: stage?.diagnostics,
        realizationReplayDiagnostics: selected?.analysis.realizationReplayDiagnostics,
        blockedByStageIndex: stage?.blockedByStageIndex
      }, null, 2)}</pre></details>
    </footer>}
  </main>;
}

const source = document.getElementById('inspection-data');
const root = document.getElementById('root');
if (!source || !root) throw new Error('Missing workspace inspection document elements.');
createRoot(root).render(<WorkspaceInspection records={JSON.parse(source.textContent || '[]')} />);
