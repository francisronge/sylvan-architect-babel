import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGeneration } from '../hooks/useGeneration';
import { useTreeBank } from '../hooks/useTreeBank';
import { useFullscreen } from '../hooks/useFullscreen';
import { submittedGenerationRequest } from '../services/generationState';
import { deriveAnalysisDisplay } from '../services/analysisDisplay';
import type { TreeBankEntrySummary } from '../services/treeBankStore';
import type { ParseBundle, ParseResult } from '../types';
import TreeVisualizer, { preloadTreeVisualizer } from '../components/LazyTreeVisualizer';
import ViewErrorBoundary from '../components/ViewErrorBoundary';
import FailurePanel, { dismissesFailure } from '../components/FailurePanel';
import ForestBackdrop from '../components/ForestBackdrop';
import { TreeBankView, TreeBankDeleteDialog } from '../components/TreeBankView';
import BabelTitle from '../components/workspace/BabelTitle';
import TreeBankBranch from '../components/workspace/TreeBankBranch';
import SentenceForm from '../components/workspace/SentenceForm';
import { EmptyWorkspace, ParseChoices } from '../components/workspace/WorkspaceStates';
import WaitingTree from '../components/workspace/WaitingTree';
import { PUBLIC_GENERATION } from './publicGeneration';

/**
 * Public Babel: today's first screen without the framework switch, model and
 * effort controls, constituent glyphing or the input panel's label, and
 * Replay as the only view of an analysis. The internal app (App.tsx) keeps
 * those controls. Both share the engine, renderer and Tree Bank records.
 *
 * Nothing but the logo and the Tree Bank sits above the tree (Francis,
 * 3-4 Nov 2026): the logo returns to the sentence box, and F toggles
 * fullscreen, with a brief hint on devices that have a keyboard.
 *
 * Every finished parse is saved to the Tree Bank as it arrives, and the star
 * in the Replay controls marks the analyses to keep (ROADMAP, Program 3B.3).
 */
type Screen = 'input' | 'tree' | 'treeBank';

// A device with a precise pointer that can hover is the best available sign
// of a keyboard; phones and tablets get no hint, and their browsers are
// already all tree.
const KEYBOARD_HINT_MS = 4000;
const offersKeyboardHint = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const typingInto = (target: EventTarget | null) => target instanceof HTMLElement
  && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.isContentEditable);

const PublicApp: React.FC = () => {
  const sentenceInputRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('The farmer eats the pig');
  const { loading, error, generate, clearFailure, dismissFailure } = useGeneration();
  const [analysisBundle, setAnalysisBundle] = useState<ParseBundle | null>(null);
  const [parsedSentence, setParsedSentence] = useState('');
  const [activeParseIndex, setActiveParseIndex] = useState(0);
  const [initialReplayStep, setInitialReplayStep] = useState<number | null>(null);
  const [screen, setScreen] = useState<Screen>('input');
  const { isFullscreen, fullscreenError, toggleFullscreen } = useFullscreen();
  const treeBank = useTreeBank();
  // The Tree Bank entry the shown bundle is saved as: null while its save
  // runs or after it failed.
  // The running parse's sentence and start, which the waiting tree grows from.
  const [waiting, setWaiting] = useState<{ sentence: string; startedAt: number } | null>(null);
  const [savedAs, setSavedAs] = useState<{ bundle: ParseBundle; id: string | null } | null>(null);

  const activeParse = analysisBundle?.analyses[activeParseIndex] ?? null;
  // Each analysis keeps the Replay step it was left on, so leaving for the
  // Tree Bank or another parse and coming back resumes there.
  const replayPositions = useRef(new WeakMap<ParseResult, number>());
  const rememberReplayPosition = useCallback((step: number) => {
    if (activeParse) replayPositions.current.set(activeParse, step);
  }, [activeParse]);
  const resumeStep = (analysis: ParseResult | null | undefined) =>
    analysis ? replayPositions.current.get(analysis) ?? null : null;
  const activeDisplay = useMemo(() => analysisBundle && activeParse
    ? deriveAnalysisDisplay(analysisBundle, activeParse, parsedSentence) : null, [analysisBundle, activeParse, parsedSentence]);
  // A running parse covers whichever screen started it; the tree shows only
  // once there is one to show.
  const showsTree = screen === 'tree' && Boolean(activeParse && activeDisplay?.displayTree);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- each selection makes a new key, which resets the boundary.
  const viewResetKey = useMemo(() => ({}), [screen, activeParse]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (typingInto(event.target)) return;
      event.preventDefault();
      void toggleFullscreen();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen]);

  // The hint shows the first time a tree appears, then fades.
  const [hintState, setHintState] = useState<'pending' | 'showing' | 'done'>('pending');
  useEffect(() => {
    if (hintState === 'pending' && showsTree && !loading) setHintState(offersKeyboardHint() ? 'showing' : 'done');
  }, [hintState, showsTree, loading]);
  useEffect(() => {
    if (hintState !== 'showing') return;
    const timer = window.setTimeout(() => setHintState('done'), KEYBOARD_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hintState]);

  // The tree view is a separate chunk; fetch it once the first screen is up.
  useEffect(() => { preloadTreeVisualizer().catch(() => {}); }, []);

  const showAnalysis = (bundle: ParseBundle, sentence: string, parseIndex: number, replayStep: number | null) => {
    if (replayStep !== null) replayPositions.current.set(bundle.analyses[parseIndex], replayStep);
    setAnalysisBundle(bundle);
    setParsedSentence(sentence);
    setActiveParseIndex(parseIndex);
    setInitialReplayStep(replayStep);
    setScreen('tree');
  };

  const saveBundle = async (bundle: ParseBundle, sentence: string, kept: boolean) => {
    setSavedAs({ bundle, id: null });
    const saved = await treeBank.save({ sentence, framework: 'minimalism', activeParseIndex: 0, bundle, kept });
    // A bundle opened meanwhile owns the star now.
    setSavedAs(current => current?.bundle === bundle ? { bundle, id: saved?.id ?? null } : current);
  };

  const handleParse = async () => {
    if (loading) return;
    const request = submittedGenerationRequest(input, PUBLIC_GENERATION);
    if (!request) return;
    setWaiting({ sentence: request.sentence, startedAt: Date.now() });
    await generate(request, bundle => {
      showAnalysis(bundle, request.sentence, 0, null);
      void saveBundle(bundle, request.sentence, false);
    });
  };

  const savedEntry = savedAs?.bundle === analysisBundle && savedAs?.id
    ? treeBank.entries.find(entry => entry.id === savedAs.id) : undefined;
  const toggleKept = () => {
    if (!analysisBundle || treeBank.saving) return;
    if (savedEntry) { void treeBank.setKept(savedEntry.id, !savedEntry.kept); return; }
    // Its save failed, or the entry was deleted: starring saves it again, kept.
    void saveBundle(analysisBundle, parsedSentence, true);
  };
  // Version-1 entries predate the star; they open as they always have.
  const keep = savedEntry?.legacy ? undefined : { kept: savedEntry?.kept ?? false, onToggle: toggleKept };

  const openTreeBankEntry = async (summary: TreeBankEntrySummary) => {
    if (loading) return;
    await treeBank.open(summary.id, ({ entry, bundle, replayStep }) => {
      setInput(entry.sentence);
      clearFailure();
      setSavedAs({ bundle, id: entry.id });
      showAnalysis(bundle, entry.sentence, entry.activeParseIndex, replayStep);
    });
  };

  const goHome = () => {
    setScreen('input');
    window.requestAnimationFrame(() => sentenceInputRef.current?.focus());
  };

  return (
    <div className={`app-shell flex flex-col overflow-hidden selection:bg-emerald-500 selection:text-white ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <ForestBackdrop paused={loading} />
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-4 py-3 md:px-8 md:py-4 shrink-0 shadow-2xl">
        <div className="w-full flex items-center">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <button type="button" onClick={goHome} title="Parse a new sentence" aria-label="Babel, parse a new sentence" className="text-left rounded-xl">
              <BabelTitle away={screen === 'treeBank'} />
            </button>
            <TreeBankBranch
              open={screen === 'treeBank'}
              count={treeBank.entries.length}
              onToggle={() => {
                setInitialReplayStep(resumeStep(activeParse));
                setScreen(current => current === 'treeBank' ? (activeParse ? 'tree' : 'input') : 'treeBank');
              }}
            />
          </div>
        </div>
      </header>

      {fullscreenError && (
        <p role="alert" className="shrink-0 border-b border-rose-500/30 bg-[#261114] px-4 py-3 text-rose-200 text-sm">{fullscreenError}</p>
      )}
      {screen !== 'treeBank' && treeBank.error && (
        <div role="alert" className="shrink-0 border-b border-rose-500/30 bg-[#261114] px-4 py-3 text-rose-200 text-sm">{treeBank.error}</div>
      )}

      <main data-babel-workspace="true" className="flex-1 relative flex flex-col overflow-hidden">
        {screen === 'treeBank' ? (
          <ViewErrorBoundary resetKey={viewResetKey} message="Your saved analyses are unchanged.">
            <TreeBankView
              entries={treeBank.entries} loading={treeBank.loading} error={treeBank.error}
              opening={treeBank.opening} onOpen={openTreeBankEntry} onDelete={treeBank.setPendingDelete}
              emptyHint=""
            />
          </ViewErrorBoundary>
        ) : (
          <>
            {showsTree && (analysisBundle?.analyses.length ?? 0) > 1 && (
              <ParseChoices
                count={analysisBundle!.analyses.length}
                active={activeParseIndex}
                onChoose={(index) => { setInitialReplayStep(resumeStep(analysisBundle?.analyses[index])); setActiveParseIndex(index); }}
              />
            )}

            <div className="absolute inset-0 z-0">
              <ViewErrorBoundary resetKey={viewResetKey}>
                {loading && waiting && <WaitingTree sentence={waiting.sentence} startedAt={waiting.startedAt} />}
                {!loading && showsTree && activeParse && activeDisplay ? (
                  <TreeVisualizer
                    initialReplayStep={initialReplayStep ?? undefined}
                    autoPlay={initialReplayStep === null}
                    onReplayStepChange={rememberReplayPosition}
                    data={activeDisplay.displayTree}
                    animated
                    derivationStages={activeParse.derivationStages}
                    sentence={activeParse.sentenceCheck?.treeReading ?? parsedSentence}
                    inputTokens={activeDisplay.inputTokens}
                    sentenceCheck={activeParse.sentenceCheck}
                    keep={keep}
                  />
                ) : !loading && <EmptyWorkspace />}
              </ViewErrorBoundary>
            </div>

            {showsTree && !loading && hintState === 'showing' && (
              <div role="status" className="keyboard-hint absolute bottom-6 right-8 z-40 pointer-events-none text-[11px] font-semibold tracking-wide text-emerald-100/70">
                Press <kbd className="mx-1 px-1.5 py-0.5 rounded border border-white/25 border-b-2 text-emerald-50/90 font-sans">F</kbd> for fullscreen
              </div>
            )}

            {!showsTree && (
              <div
                data-babel-tree-controls="bottom"
                className="absolute left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 md:px-8"
                style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onKeyDown={(event) => {
                  if (!error || !dismissesFailure(event.nativeEvent)) return;
                  event.preventDefault();
                  sentenceInputRef.current?.focus();
                  dismissFailure();
                }}
              >
                <div className="glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden p-4 md:p-6">
                  {error && (
                    <FailurePanel
                      message={error.message}
                      failure={error.failure}
                      rawOutput={error.rawOutput}
                      generationRecord={error.generationRecord}
                      sentence={error.request?.sentence}
                      inputTokens={error.inputTokens}
                      onDismiss={() => { sentenceInputRef.current?.focus(); dismissFailure(); }}
                    />
                  )}
                  <SentenceForm
                    inputRef={sentenceInputRef}
                    value={input}
                    onChange={setInput}
                    onSubmit={() => void handleParse()}
                    loading={loading}
                    placeholder="Plant a Minimalist linguistic seed..."
                  />
                </div>
              </div>
            )}
          </>
        )}

        {treeBank.pendingDelete && (
          <TreeBankDeleteDialog entry={treeBank.pendingDelete} onConfirm={treeBank.deletePending} onCancel={() => treeBank.setPendingDelete(null)} />
        )}
      </main>

    </div>
  );
};

export default PublicApp;
