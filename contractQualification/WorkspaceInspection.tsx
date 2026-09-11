import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import TreeVisualizer from '../components/TreeVisualizer';
import { buildDerivationCanvasData } from '../replay/replayCompiler';
import type { SyntaxNode } from '../types';
import '../styles.css';
import './workspaceInspection.css';

interface Inspection {
  title: string;
  record: {
    kind: 'authored-workspace-inspection';
    rawOutput: { sha256: string };
    repairDiagnostics: unknown[];
    payload: unknown;
    analyses: Array<{
      analysisIndex: number;
      stages: Array<{
        stageIndex: number;
        authoredStage: unknown;
        workspaceForest: SyntaxNode[] | null;
        diagnostic?: unknown;
        blockedByStageIndex?: number;
      }> | null;
    }>;
  };
}

function WorkspaceInspection({ records }: { records: Inspection[] }) {
  const [selection, setSelection] = useState(0);
  const [stageIndex, setStageIndex] = useState(0);
  const choices = useMemo(() => records.flatMap(({ title, record }) => record.analyses.map((analysis) => ({
    title: `${title} / Analysis ${analysis.analysisIndex + 1}`, record, analysis
  }))), [records]);
  const selected = choices[selection];
  const stages = selected?.analysis.stages ?? [];
  const stage = stages[stageIndex];
  const tree = useMemo(() => buildDerivationCanvasData(stage?.workspaceForest ?? []), [stage]);
  const authored = stage?.authoredStage && typeof stage.authoredStage === 'object'
    ? stage.authoredStage as Record<string, unknown> : {};

  return <main className="workspace-inspection">
    <header>
      <span>Stage inspection</span>
      <select aria-label="Analysis" value={selection} onChange={(event) => {
        setSelection(Number(event.target.value)); setStageIndex(0);
      }}>
        {choices.map((choice, index) => <option key={index} value={index}>{choice.title}</option>)}
      </select>
      <nav aria-label="Stage controls">
        <button title="Previous stage" aria-label="Previous stage" disabled={stageIndex === 0}
          onClick={() => setStageIndex(stageIndex - 1)}><ArrowLeft size={18} /></button>
        <select aria-label="Stage" value={stageIndex} disabled={!stages.length}
          onChange={(event) => setStageIndex(Number(event.target.value))}>
          {stages.map((entry, index) => <option key={entry.stageIndex} value={index}>Stage {entry.stageIndex + 1} / {stages.length}</option>)}
        </select>
        <button title="Next stage" aria-label="Next stage" disabled={stageIndex >= stages.length - 1}
          onClick={() => setStageIndex(stageIndex + 1)}><ArrowRight size={18} /></button>
      </nav>
    </header>
    <section className="inspection-tree" aria-label="Authored workspace" data-stage-index={stageIndex}>
      {tree ? <TreeVisualizer key={`${selection}:${stageIndex}`} data={tree} />
        : <p>{stage?.blockedByStageIndex !== undefined
          ? `Expansion blocked by stage ${stage.blockedByStageIndex + 1}.`
          : stage?.diagnostic ? 'Workspace could not be expanded.'
            : stage?.workspaceForest ? 'Empty workspace.' : 'No readable stages.'}</p>}
    </section>
    <footer>
      <h1>{typeof authored.statement === 'string' ? authored.statement : `Stage ${stageIndex + 1}`}</h1>
      <p>{typeof authored.stageRecord === 'string' ? authored.stageRecord : ''}</p>
      <details><summary>Original fields and diagnostics</summary><pre>{JSON.stringify({
        rawOutput: selected?.record.rawOutput,
        repairDiagnostics: selected?.record.repairDiagnostics,
        authoredStage: stage?.authoredStage,
        diagnostic: stage?.diagnostic,
        blockedByStageIndex: stage?.blockedByStageIndex
      }, null, 2)}</pre></details>
    </footer>
  </main>;
}

const source = document.getElementById('inspection-data');
const root = document.getElementById('root');
if (!source || !root) throw new Error('Missing workspace inspection document elements.');
createRoot(root).render(<WorkspaceInspection records={JSON.parse(source.textContent || '[]')} />);
