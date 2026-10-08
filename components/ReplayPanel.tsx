import React, { useMemo } from 'react';
import { Scan } from 'lucide-react';
import type { DerivationStage } from '../types';
import {
  buildReplayDisplayDetailBlocks,
  buildReplayPanelContent,
  formatReplayBlockLine,
  formatReplayBlockTitle,
  type PlaybackStep
} from '../replay/replayCompiler.ts';
import RootLogo from './RootLogo';

export interface ReplayPanelProps {
  panelRef: React.Ref<HTMLDivElement>;
  bottom: number;
  right: number;
  currentReplayKind: string;
  activeRelationMoment: { stageIndex: number; relationIndex: number } | null;
  playedRelationIndicesAttribute: string;
  activeStep: PlaybackStep | null;
  playbackSteps: PlaybackStep[];
  derivationStages?: DerivationStage[];
  sentence: string;
  activeStepIndex: number;
  activeStageDisplayLabel: string;
  canStepBackward: boolean;
  canStepForward: boolean;
  isAutoPlaying: boolean;
  isScrubbing: boolean;
  handlePrevStep: () => void;
  handleNextStep: () => void;
  handleTogglePlayback: () => void;
  onFit: () => void;
  onPause: () => void;
  onScrubbingChange: (scrubbing: boolean) => void;
  onStepChange: (index: number) => void;
}

// Playback state and viewport measurement stay with the tree; this component
// keeps the same panel root so its ref measures the visible controls directly.
const ReplayPanel: React.FC<ReplayPanelProps> = ({
  panelRef, bottom, right, currentReplayKind, activeRelationMoment,
  playedRelationIndicesAttribute, activeStep, playbackSteps, derivationStages,
  sentence, activeStepIndex, activeStageDisplayLabel, canStepBackward, canStepForward,
  isAutoPlaying, isScrubbing, handlePrevStep, handleNextStep, handleTogglePlayback,
  onFit, onPause, onScrubbingChange, onStepChange
}) => {
  const activePanelContent = buildReplayPanelContent(activeStep, derivationStages);
  const activeReplaySupportLines = activePanelContent.supportLines;
  const replayDisplayDetailBlocksByStepIndex = useMemo(
    () => buildReplayDisplayDetailBlocks(playbackSteps),
    [playbackSteps]
  );
  const activeDisplayDetailBlocks = (
    replayDisplayDetailBlocksByStepIndex.get(activeStepIndex) || []
  ).filter((block) => !(
    activeReplaySupportLines.length > 0
    && String(block.title || '').trim().toLowerCase() === 'relations'
  ));
  const activeNoteDisplay = (() => {
    const note = String(activeStep?.note ?? '');
    if (!note.trim()) return '';
    if (note === activePanelContent.heading
      || activeReplaySupportLines.some(line => line.value === note)
      || activeDisplayDetailBlocks.some(block => block.lines.some(line =>
        formatReplayBlockLine(block.title, line, playbackSteps) === note))) return '';
    const normalizeSurfaceText = (value?: string): string =>
      String(value || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (
      note.toLowerCase().startsWith('committed surface order:')
      && sentence
      && normalizeSurfaceText(note.replace(/^Committed surface order:\s*/i, '')) === normalizeSurfaceText(sentence)
    ) {
      return '';
    }
    return note;
  })();
  const stepPercent = playbackSteps.length > 1
    ? (activeStepIndex / (playbackSteps.length - 1)) * 100
    : 0;

  return (
    <div
      ref={panelRef}
      data-babel-replay-panel="true"
      data-babel-replay-kind={currentReplayKind || undefined}
      data-babel-active-relation-stage-index={activeRelationMoment?.stageIndex}
      data-babel-active-relation-index={activeRelationMoment?.relationIndex}
      data-babel-played-relation-indices={playedRelationIndicesAttribute}
      className="babel-replay-panel absolute z-40 flex flex-col overflow-hidden rounded-2xl border border-[#17362d] bg-[#020806]/[0.96] p-4 shadow-2xl"
      style={{ bottom, right }}
    >
      <div className="babel-replay-controls flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={handlePrevStep}
          disabled={!canStepBackward}
          className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Prev
        </button>
        <button
          type="button"
          onClick={handleTogglePlayback}
          className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/20"
        >
          {isAutoPlaying ? 'Pause' : (activeStepIndex >= playbackSteps.length - 1 ? 'Replay' : 'Play')}
        </button>
        <button
          type="button"
          onClick={handleNextStep}
          disabled={!canStepForward}
          className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next
        </button>
        <button type="button" title="Fit tree" aria-label="Fit tree"
          className="shrink-0 rounded-lg border border-white/10 p-1.5 text-white/70 hover:text-emerald-300"
          onClick={onFit}>
          <Scan size={14} />
        </button>
        <div className="ml-auto text-right">
          <div className="text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
            Replay {activeStepIndex + 1}/{playbackSteps.length}
            {activeStageDisplayLabel ? ` \u00b7 ${activeStageDisplayLabel}` : ''}
          </div>
        </div>
      </div>
      <div data-babel-replay-timeline="true" className="relative h-8 shrink-0">
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-black/50 rounded-full border border-white/5" />
        <div
          className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 bg-[#064e3b] rounded-full ${isScrubbing ? '' : 'transition-all duration-150'}`}
          style={{ width: `${stepPercent}%` }}
        />
        <input
          type="range"
          aria-label="Replay frame"
          min={0}
          max={Math.max(playbackSteps.length - 1, 0)}
          value={activeStepIndex}
          onPointerDown={() => {
            onPause();
            onScrubbingChange(true);
          }}
          onPointerUp={() => onScrubbingChange(false)}
          onPointerCancel={() => onScrubbingChange(false)}
          onMouseUp={() => onScrubbingChange(false)}
          onTouchEnd={() => onScrubbingChange(false)}
          onBlur={() => onScrubbingChange(false)}
          onChange={(event) => {
            onPause();
            onStepChange(Number(event.target.value));
          }}
          className="derivation-slider absolute inset-0 w-full h-full z-10"
        />
        <div
          className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${isScrubbing ? '' : 'transition-all duration-150'}`}
          style={{ left: `${stepPercent}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shadow-[0_0_12px_rgba(167,243,208,0.75)]">
            <RootLogo size={12} blend={false} zoom={1.12} />
          </div>
        </div>
      </div>
      <div
        data-babel-replay-details="true"
        className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 space-y-3"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {activeStep?.replayKind && activeStep.replayKind !== 'macro' && (
            <span className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90">
              {activeStep.replayKind === 'micro' ? 'Construction' : 'Relation'}
            </span>
          )}
          <div data-babel-replay-summary="true" className="text-[11px] text-white font-semibold">
            {activePanelContent.heading}
          </div>
        </div>
        {activeReplaySupportLines.length > 0 && (
          <div className="space-y-1 text-[10px] tracking-[0.12em] text-emerald-300/90">
            {activeReplaySupportLines.map((line) => (
              <div key={line.key} className="leading-relaxed"
                aria-label={line.literal !== undefined ? `${line.label}: ${line.value}; value: ${line.literal}` : undefined}>
                {line.label && <span>{line.label}:</span>}
                <span className={`${line.label ? 'ml-2 ' : ''}text-[11px] tracking-normal text-white/92 whitespace-pre-wrap`}>
                  {line.value}
                  {line.literal !== undefined && line.literal !== line.value && (
                    <> · {line.literal === '' ? '""' : line.literal}</>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {activeDisplayDetailBlocks.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
            {activeDisplayDetailBlocks.map((block, blockIndex) => (
              <div key={`${block.title}-${blockIndex}`}>
                {!(activeStep?.replayKind === 'macro' && block.title === 'Stage Record') && (
                  <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/90 mb-2">
                    {formatReplayBlockTitle(block.title)}
                  </div>
                )}
                <div className="space-y-1">
                  {block.lines.map((line, lineIndex) => (
                    <div key={`${block.title}-${lineIndex}`} className="text-[11px] text-white/90 leading-relaxed whitespace-pre-line">
                      {formatReplayBlockLine(block.title, line, playbackSteps)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeNoteDisplay && (
          <div className="text-[11px] text-white/88">
            {activeNoteDisplay}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayPanel;
