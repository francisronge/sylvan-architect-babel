import React from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { GenerationRecord, ParseFailure, RawOutputArtifact } from '../types';

interface FailurePanelProps {
  message: string;
  failure?: ParseFailure;
  rawOutput?: RawOutputArtifact;
  generationRecord?: GenerationRecord;
  children?: React.ReactNode;
}

const formatOffendingValue = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const downloadFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const downloadRawOutput = (artifact: RawOutputArtifact) => {
  const binary = window.atob(artifact.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  downloadFile(new Blob([bytes], { type: artifact.mediaType }), `babel-model-output-${artifact.sha256.slice(0, 12)}.txt`);
};

const FailurePanel: React.FC<FailurePanelProps> = ({
  message,
  failure,
  rawOutput,
  generationRecord,
  children
}) => (
  <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-300 shadow-inner">
    <div className="flex items-start gap-3">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-3">
        <p className="serif italic text-rose-200">{message}</p>
        {failure && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 font-mono text-[10px]">
            <dt className="text-rose-400/70">Class</dt>
            <dd>{failure.class}</dd>
            <dt className="text-rose-400/70">Rule</dt>
            <dd>{failure.ruleId}</dd>
            <dt className="text-rose-400/70">Stage</dt>
            <dd>{failure.stageIndex === null ? 'pre-parse / not applicable' : failure.stageIndex + 1}</dd>
            <dt className="text-rose-400/70">Path</dt>
            <dd className="break-all">{failure.fieldPath}</dd>
          </dl>
        )}
        {failure && (
          <details className="rounded-xl border border-rose-500/15 bg-black/20 p-2">
            <summary className="cursor-pointer font-black uppercase tracking-widest text-[9px] text-rose-300">
              Offending value
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-rose-100/80">
              {formatOffendingValue(failure.offendingValue)}
            </pre>
          </details>
        )}
        {rawOutput && (
          <button
            type="button"
            onClick={() => downloadRawOutput(rawOutput)}
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/15 px-3 py-2 font-black uppercase tracking-widest text-[9px] text-rose-100 hover:bg-rose-500/25"
          >
            <Download size={12} />
            Download raw output ({rawOutput.retainedByteLength} bytes)
            {rawOutput.truncated ? ' — capped copy' : ''}
          </button>
        )}
        {children}
        {generationRecord && (
          <button
            type="button"
            onClick={() => downloadFile(
              new Blob([JSON.stringify({ message, failure, rawOutput, generationRecord }, null, 2)], { type: 'application/json' }),
              'babel-failed-generation.json'
            )}
            className="flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-[10px] font-bold text-rose-100 hover:bg-rose-500/25"
          >
            <Download size={12} /> Download failure record
          </button>
        )}
      </div>
    </div>
  </div>
);

export default FailurePanel;
