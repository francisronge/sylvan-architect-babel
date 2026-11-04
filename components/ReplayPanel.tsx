import React, { useMemo } from 'react';
import { buildReplayPanelContent, buildReplayStageRuns } from '../replay/replayPanel.ts';
import { buildReplayWorkspace } from '../replay/replayWorkspace.ts';
import {
  buildReplayDisplayDetailBlocks,
  formatReplayBlockLine,
  formatReplayBlockTitle
} from '../replay/replayPanelFormatting.ts';
import { type PlaybackStep } from '../replay/types.ts';
import type { DerivationStage } from '../types';
import ReplayWorkspace from './ReplayWorkspace';

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
  /** The sentence's word list, which terminals' token positions index. */
  inputTokens: readonly string[];
  activeStepIndex: number;
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

const REPLAY_ICON_BUTTON = 'shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-white/75 enabled:hover:text-white enabled:hover:bg-white/[0.06] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/70';

// Playback state and viewport measurement stay with the tree; this component
// keeps the same panel root so its ref measures the visible controls directly.
const ReplayPanel: React.FC<ReplayPanelProps> = ({
  panelRef, bottom, right, currentReplayKind, activeRelationMoment,
  playedRelationIndicesAttribute, activeStep, playbackSteps, derivationStages,
  sentence, inputTokens, activeStepIndex, canStepBackward, canStepForward,
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
  const stageRuns = useMemo(() => buildReplayStageRuns(playbackSteps), [playbackSteps]);
  const activeRun = Math.max(0, stageRuns.findIndex(run => activeStepIndex >= run.start && activeStepIndex < run.start + run.count));
  // The rail is painted in the range input's own mapping, step i at
  // i / (N - 1) of its width, so pressing the knob selects the step it shows.
  // A stage's segment reaches halfway to the neighbouring stages' steps.
  const lastStep = Math.max(playbackSteps.length - 1, 1);
  const knobPercent = (activeStepIndex / lastStep) * 100;
  const segmentEdge = (step: number) => Math.min(Math.max(((step - 0.5) / lastStep) * 100, 0), 100);
  // A construction step's one unlabelled line (D + N → DP) sits beside its heading.
  const inlineSupportLine = activeStep?.replayKind === 'micro' && activeReplaySupportLines.length === 1 && !activeReplaySupportLines[0].label
    ? activeReplaySupportLines[0].value : '';
  const workspace = buildReplayWorkspace(activeStep, inputTokens);
  // A stage's own step shows its statement as every smaller step does, as the
  // stage's line above its Stage Record, not as a labelled detail.
  const macroStatement = activeStep?.replayKind === 'macro'
    ? activeReplaySupportLines.find(line => line.label === 'Statement')?.value ?? '' : '';
  const listedSupportLines = macroStatement ? activeReplaySupportLines.filter(line => line.label !== 'Statement') : activeReplaySupportLines;
  const playLabel = isAutoPlaying ? 'Pause' : (activeStepIndex >= playbackSteps.length - 1 ? 'Replay' : 'Play');

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
      <div className="babel-replay-controls flex items-center gap-1">
        <button type="button" onClick={handlePrevStep} disabled={!canStepBackward} title="Previous step" className={REPLAY_ICON_BUTTON}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 6 V18" /><path d="M17 6 L10 12 L17 18" />
          </svg>
          <span className="sr-only">Prev</span>
        </button>
        <button type="button" onClick={handleTogglePlayback} title={playLabel}
          className="shrink-0 w-12 h-12 rounded-full flex items-center justify-center bg-emerald-200 text-[#052e1f] hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020806]">
          {isAutoPlaying ? (
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
              <rect x="6.5" y="5" width="4" height="14" rx="1.4" /><rect x="13.5" y="5" width="4" height="14" rx="1.4" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-5 h-5 translate-x-[1px]" fill="currentColor" aria-hidden="true">
              <path d="M8 5.5 C8 4.7 8.9 4.2 9.6 4.7 L18.4 11.2 C19 11.6 19 12.4 18.4 12.8 L9.6 19.3 C8.9 19.8 8 19.3 8 18.5 Z" />
            </svg>
          )}
          <span className="sr-only">{playLabel}</span>
        </button>
        <button type="button" onClick={handleNextStep} disabled={!canStepForward} title="Next step" className={REPLAY_ICON_BUTTON}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 6 V18" /><path d="M7 6 L14 12 L7 18" />
          </svg>
          <span className="sr-only">Next</span>
        </button>
        {/* The step count stands above the tree, in the Replay header. */}
        <div className="flex-1" />
        <button type="button" title="Fit tree" aria-label="Fit tree" className={REPLAY_ICON_BUTTON} onClick={onFit}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M4 9 V5 H8 M16 5 H20 V9 M20 15 V19 H16 M8 19 H4 V15" />
            <path d="M12 9 L9 14 M12 9 L15 14" className="text-emerald-200" stroke="currentColor" />
          </svg>
        </button>
      </div>
      {/* The stage rail: one segment per stage, as long as its steps. The
          range input over it keeps dragging, tapping and arrow keys. */}
      <div data-babel-replay-timeline="true" className="relative h-11 shrink-0 mb-1">
        <div className="absolute inset-0" aria-hidden="true">
          {stageRuns.map((run, index) => {
            const left = segmentEdge(run.start);
            const right = index === stageRuns.length - 1 ? 100 : segmentEdge(run.start + run.count);
            const filled = index < activeRun ? 1 : index > activeRun ? 0 : Math.min(Math.max((knobPercent - left) / Math.max(right - left, 1e-9), 0), 1);
            // 3px gaps between stages; none at the rail's ends.
            const inset = (edge: boolean) => (edge ? 0 : 1.5);
            return (
              <div key={run.start} data-babel-replay-stage-segment={index === activeRun ? 'active' : index < activeRun ? 'played' : 'ahead'}
                className={`absolute top-1/2 -translate-y-1/2 h-2 rounded-full overflow-hidden ${index === activeRun ? 'bg-emerald-200/[0.16]' : 'bg-white/[0.08]'}`}
                style={{
                  left: `calc(${left}% + ${inset(index === 0)}px)`,
                  width: `calc(${right - left}% - ${inset(index === 0) + inset(index === stageRuns.length - 1)}px)`
                }}>
                <div className={`absolute inset-y-0 left-0 rounded-full ${index === activeRun ? 'bg-emerald-200' : 'bg-emerald-600'} ${isScrubbing ? '' : 'transition-all duration-150'}`}
                  style={{ width: `${filled * 100}%` }} />
              </div>
            );
          })}
        </div>
        <div aria-hidden="true"
          className={`absolute top-1/2 w-3.5 h-3.5 rounded-full bg-emerald-200 shadow-[0_0_0_4px_rgba(167,243,208,0.15)] pointer-events-none ${isScrubbing ? '' : 'transition-all duration-150'}`}
          style={{ left: `${knobPercent}%`, transform: 'translate(-50%, -50%)' }} />
        <input
          type="range"
          aria-label="Replay frame"
          min={0}
          max={Math.max(playbackSteps.length - 1, 0)}
          value={activeStepIndex}
          aria-valuetext={`Replay ${activeStepIndex + 1}/${playbackSteps.length}`}
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
      </div>
      <div
        data-babel-replay-details="true"
        className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1 space-y-2.5"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <div data-babel-replay-summary="true" className="serif text-[18px] leading-tight text-white font-semibold">
            {activePanelContent.heading}
          </div>
          {inlineSupportLine && <div className="text-[12px] text-emerald-300/90">{inlineSupportLine}</div>}
        </div>
        {!inlineSupportLine && listedSupportLines.length > 0 && (
          <div className="space-y-1">
            {listedSupportLines.map((line) => (
              <div key={line.key} className="flex flex-wrap items-baseline gap-x-2 leading-snug"
                aria-label={line.literal !== undefined ? `${line.label}: ${line.value}; value: ${line.literal}` : undefined}>
                {line.label && <span className="text-[12px] text-emerald-300/90">{line.label}</span>}
                <span className="text-[15px] text-white/90 whitespace-pre-wrap">
                  {line.value}
                  {line.literal !== undefined && line.literal !== line.value && (
                    <> · {line.literal === '' ? '""' : line.literal}</>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {macroStatement && (
          <div data-babel-replay-stage-context="true" className="pt-2.5 border-t border-white/[0.06]">
            <p className="serif italic text-[15px] leading-snug text-emerald-300/90 max-w-[68ch]">{macroStatement}</p>
          </div>
        )}
        {activeDisplayDetailBlocks.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3">
            {activeDisplayDetailBlocks.map((block, blockIndex) => (
              <div key={`${block.title}-${blockIndex}`}>
                {!(activeStep?.replayKind === 'macro' && block.title === 'Stage Record') && (
                  <div className="text-[12px] text-emerald-300/90 mb-1">
                    {formatReplayBlockTitle(block.title)}
                  </div>
                )}
                <div className="space-y-1">
                  {block.lines.map((line, lineIndex) => (
                    <div key={`${block.title}-${lineIndex}`} className="text-[15px] text-white/85 leading-relaxed whitespace-pre-line max-w-[68ch]">
                      {formatReplayBlockLine(block.title, line, playbackSteps)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {activePanelContent.stageStatement && (
          <div data-babel-replay-stage-context="true" className="pt-2.5 border-t border-white/[0.06] space-y-2.5">
            <p className="serif italic text-[15px] leading-snug text-emerald-300/90 max-w-[68ch]">{activePanelContent.stageStatement}</p>
            {workspace && <ReplayWorkspace workspace={workspace} />}
          </div>
        )}
        {activeNoteDisplay && (
          <div className="text-[12px] text-white/88">
            {activeNoteDisplay}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReplayPanel;
