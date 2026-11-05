import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useGeneration } from './hooks/useGeneration';
import { submittedGenerationRequest } from './services/generationState';
import { captureVisibleTreeSnapshot } from './services/treeSnapshot';
import { deriveAnalysisDisplay } from './services/analysisDisplay';
import { reopenedReplayStep } from './services/treeBankRecords';
import { useTreeBank } from './hooks/useTreeBank';
import { useModelSelection } from './hooks/useModelSelection';
import { useFullscreen } from './hooks/useFullscreen';
import { useDevPreview, type DevAnalysisOptions, type SavedPreview } from './hooks/useDevPreview';
import type { TreeBankEntrySummary } from './services/treeBankStore';
import { TreeBankView, TreeBankDeleteDialog } from './components/TreeBankView';
import {
  ParseBundle,
  ParseResult
} from './types';
import TreeVisualizer, { preloadTreeVisualizer } from './components/LazyTreeVisualizer';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import BabelTitle from './components/workspace/BabelTitle';
import { FullscreenButton, TreeBankToggle } from './components/workspace/HeaderButtons';
import SentenceBar from './components/workspace/SentenceBar';
import { EmptyWorkspace, GenerationLoading, ParseChoices } from './components/workspace/WorkspaceStates';
import ModelControls from './components/ModelControls';
import ForestBackdrop from './components/ForestBackdrop';
import {
  Key,
  Triangle,
  Check,
  Archive
} from 'lucide-react';

/**
 * The internal app: public Babel's screens (PublicApp.tsx) with the research
 * controls kept, namely the framework switch, model and effort menus,
 * Constituent Glyphing, Save to Tree Bank and fullscreen. Replay is the only
 * view of an analysis (Francis, 31 Oct 2026).
 *
 * The input screen holds the sentence bar; the tree screen gives the whole
 * workspace to the tree, and the logo returns to the input screen (ROADMAP,
 * Program 3B.2: "anything is fine as long as it doesn't hog space from the
 * tree").
 */
type Screen = 'input' | 'tree' | 'treeBank';

interface AppProps {
  /** Local harnesses can offer their own catalog subset without changing public provider routes. */
  modelIds?: readonly string[];
}

const App: React.FC<AppProps> = ({ modelIds }) => {
  const models = useModelSelection(modelIds);
  const { modelRoute, reasoningEffort, activeReasoningEffort, inferModelRoute, adoptModel, adoptEffort } = models;
  const sentenceInputRef = useRef<HTMLTextAreaElement>(null);
  const homeButtonRef = useRef<HTMLButtonElement>(null);
  const [input, setInput] = useState('The farmer eats the pig');
  // A failure and its downloads stay until the next generation starts or the
  // user dismisses it, also while the model or effort for that next request is
  // being chosen.
  const { loading, error, needsKey, generate, clearFailure, dismissFailure, resetGeneration, reportError } = useGeneration();
  const [analysisBundle, setAnalysisBundle] = useState<ParseBundle | null>(null);
  const [activeParseIndex, setActiveParseIndex] = useState(0);
  const [screen, setScreen] = useState<Screen>('input');
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('minimalism');
  const [parsedFramework, setParsedFramework] = useState<'xbar' | 'minimalism'>('minimalism');
  const { isFullscreen, fullscreenError, toggleFullscreen } = useFullscreen();
  const [parsedSentence, setParsedSentence] = useState('The farmer eats the pig');
  const treeBank = useTreeBank();
  // Each analysis keeps the Replay step it was left on, so leaving for the
  // input screen, the Tree Bank or another parse and coming back resumes there.
  const replayPositions = useRef(new WeakMap<ParseResult, number>());
  const [initialReplayPosition, setInitialReplayPosition] = useState<number | null>(null);
  const activeParse: ParseResult | null = analysisBundle?.analyses?.[activeParseIndex] ?? null;
  const activeDisplay = useMemo(() => analysisBundle && activeParse
    ? deriveAnalysisDisplay(analysisBundle, activeParse, parsedSentence) : null, [analysisBundle, activeParse, parsedSentence]);
  const rememberReplayPosition = useCallback((step: number) => {
    if (activeParse) replayPositions.current.set(activeParse, step);
  }, [activeParse]);
  const resumeStep = (analysis: ParseResult | null | undefined) =>
    analysis ? replayPositions.current.get(analysis) ?? null : null;
  const changeParse = (index: number) => {
    setInitialReplayPosition(resumeStep(analysisBundle?.analyses[index]));
    setActiveParseIndex(index);
  };
  // The tree screen is offered only for an analysis with nothing pending: a
  // running request or a shown failure belongs to the input screen.
  const treeOrInput = (): Screen => activeParse && !loading && !error ? 'tree' : 'input';
  const toggleTreeBank = () => {
    setInitialReplayPosition(resumeStep(activeParse));
    setScreen(current => current === 'treeBank' ? treeOrInput() : 'treeBank');
  };
  const goHome = () => {
    setInitialReplayPosition(resumeStep(activeParse));
    setScreen('input');
    window.requestAnimationFrame(() => sentenceInputRef.current?.focus());
  };
  const showsTree = screen === 'tree' && Boolean(activeParse && activeDisplay?.displayTree);
  // A view that fails to render shows a retryable notice in its own area; the
  // header stays usable and this component keeps the analysis. Choosing another
  // screen, parse or analysis clears the notice.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- each selection makes a new key, which resets the boundary.
  const viewResetKey = useMemo(() => ({}), [screen, activeParse]);
  const hasAmbiguity = (analysisBundle?.analyses?.length ?? 0) > 1;
  const isTreeBankView = screen === 'treeBank';
  // Dismissal closes only the failure display; nothing is requested, and the
  // draft and Tree Bank stay. With an analysis held, it returns to that
  // analysis at its paused frame and focus moves to the logo, which leads back
  // to the draft; otherwise focus stays in the sentence box for a retry.
  const dismissShownFailure = () => {
    if (activeParse) {
      setInitialReplayPosition(resumeStep(activeParse));
      setScreen('tree');
      homeButtonRef.current?.focus();
    } else {
      sentenceInputRef.current?.focus();
    }
    dismissFailure();
  };
  const acceptDevAnalysis = useCallback((bundle: ParseBundle, options: DevAnalysisOptions) => {
    setInitialReplayPosition(null);
    setAnalysisBundle(bundle);
    const nextSentence = String(options.sentence || '').trim();
    if (nextSentence) {
      setParsedSentence(nextSentence);
      setInput(nextSentence);
    }
    if (options.framework) setFramework(options.framework);
    // A record naming no framework predates Minimalism as the default, when an
    // unnamed request was X-bar, so it keeps reading as X-bar.
    setParsedFramework(options.framework || bundle.analyses[0]?.provenance?.framework || 'xbar');
    if (options.modelRoute) adoptModel(options.modelRoute, options.reasoningEffort || reasoningEffort);
    else if (options.reasoningEffort) adoptEffort(options.reasoningEffort);
    setActiveParseIndex(0);
    setScreen('tree');
    resetGeneration();
  }, [reasoningEffort, adoptModel, adoptEffort, resetGeneration]);

  const acceptSavedPreview = useCallback((preview: SavedPreview) => {
    const { bundle, sentence, framework: nextFramework } = preview;
    setInitialReplayPosition(null);
    setAnalysisBundle(bundle);
    setParsedSentence(sentence);
    setInput(sentence);
    setFramework(nextFramework);
    setParsedFramework(nextFramework);
    adoptModel(preview.modelRoute || inferModelRoute(bundle.modelUsed), preview.reasoningEffort || reasoningEffort);
    setActiveParseIndex(0);
    setScreen('tree');
    resetGeneration();
  }, [reasoningEffort, adoptModel, inferModelRoute, resetGeneration]);

  useDevPreview({
    analysisBundle,
    onAnalysis: acceptDevAnalysis,
    onPreview: acceptSavedPreview,
    onError: reportError
  });

  // The tree view is a separate chunk; fetch it once the first screen is up.
  useEffect(() => { preloadTreeVisualizer().catch(() => {}); }, []);

  const handleParse = async () => {
    if (loading) return;
    const request = submittedGenerationRequest(input, {
      framework,
      modelId: modelRoute,
      settings: models.requestSettings
    });
    if (!request) return;

    setInitialReplayPosition(resumeStep(activeParse));
    await generate(request, data => {
      setInitialReplayPosition(null);
      setAnalysisBundle(data);
      adoptModel(data.requestedModelId || modelRoute, data.requestedReasoningEffort || activeReasoningEffort);
      setParsedSentence(request.sentence);
      setParsedFramework(framework);
      setActiveParseIndex(0);
      setScreen('tree');
    });
  };

  const handleSaveCurrentTree = async () => {
    if (!analysisBundle || treeBank.saving || loading) return;

    const sentence = parsedSentence.trim() || input.trim();
    if (!sentence) return;

    const entry = {
      sentence,
      framework: parsedFramework,
      activeParseIndex,
      bundle: analysisBundle,
      view: 'derivation' as const,
      replayStep: resumeStep(activeParse),
      abstractionMode,
      treeSnapshotDataUrl: captureVisibleTreeSnapshot()
    };

    await treeBank.save(entry);
  };

  const handleOpenTreeBankEntry = async (summary: TreeBankEntrySummary) => {
    if (loading) return;
    await treeBank.open(summary.id, ({ entry, bundle, view, replayStep: savedStep, abstractionMode: savedAbstraction }) => {
      const selected = bundle.analyses[entry.activeParseIndex];
      const replayStep = reopenedReplayStep(view, savedStep);
      if (replayStep !== null) replayPositions.current.set(selected, replayStep);
      setInitialReplayPosition(replayStep);
      setAnalysisBundle(bundle);
      setParsedSentence(entry.sentence);
      setInput(entry.sentence);
      setFramework(entry.framework);
      setParsedFramework(entry.framework);
      adoptModel(bundle.requestedModelId || inferModelRoute(bundle.modelUsed), bundle.requestedReasoningEffort || reasoningEffort);
      setActiveParseIndex(entry.activeParseIndex);
      setAbstractionMode(savedAbstraction);
      clearFailure();
      setScreen('tree');
    });
  };

  return (
    <div
      className={`app-shell flex flex-col overflow-hidden selection:bg-emerald-500 selection:text-white ${
        isFullscreen ? 'is-fullscreen' : ''
      }`}
    >
      <ForestBackdrop paused={loading} />
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-4 py-3 md:px-8 md:py-4 shrink-0 shadow-2xl">
        <div className="w-full flex flex-wrap min-[1600px]:flex-nowrap items-center gap-3 md:gap-6">
            <button
              ref={homeButtonRef}
              type="button"
              onClick={goHome}
              title="Parse a new sentence"
              aria-label="Babel, parse a new sentence"
              className="shrink-0 text-left rounded-xl"
            >
              <BabelTitle away={isTreeBankView} />
            </button>

            <div className="basis-full min-[1600px]:basis-auto min-w-0 flex-1">
              <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 md:gap-3">
                <div className="min-w-0 xl:contents xl:[&>button]:grow xl:[&>button]:justify-center flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3">
                  {!isTreeBankView ? (
                    <>
                      <button
                        onClick={() => setFramework(framework === 'xbar' ? 'minimalism' : 'xbar')}
                        className={`flex items-center gap-2 md:gap-2.5 min-w-[14rem] xl:min-w-0 justify-center px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest shadow-inner group whitespace-nowrap ${
                          framework === 'minimalism'
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        }`}
                      >
                        <span
                          className={`inline-flex items-center justify-center min-w-4 text-[11px] font-black tracking-normal leading-none normal-case ${
                            framework === 'xbar' ? 'text-emerald-400' : 'text-purple-300'
                          }`}
                          aria-hidden="true"
                        >
                          {framework === 'xbar' ? (
                            <span className="relative inline-flex w-4 items-center justify-center leading-none">
                              X
                              <span className="absolute left-1/2 top-[-0.16rem] h-[2px] w-3 -translate-x-1/2 rounded-full bg-current" />
                            </span>
                          ) : 'vP'}
                        </span>
                        {framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}
                      </button>

                      <button
                        onClick={() => setAbstractionMode(!abstractionMode)}
                        aria-pressed={abstractionMode}
                        className={`flex items-center gap-2 md:gap-2.5 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest shadow-inner group whitespace-nowrap ${
                          abstractionMode
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : 'bg-white/5 border-white/10 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30'
                        }`}
                      >
                        <Triangle size={12} className={`${abstractionMode ? 'fill-amber-400' : 'group-hover:text-emerald-400'} transition-colors`} />
                        Constituent Glyphing
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-3 px-4 py-2 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-emerald-300/90 text-[9px] font-black uppercase tracking-widest">
                      <Archive size={12} />
                      Tree Bank Library
                    </div>
                  )}
                </div>

                <div className="min-w-0 xl:contents xl:[&>button]:grow xl:[&>button]:justify-center flex flex-wrap items-center gap-2 md:gap-3">
                  {!isTreeBankView && (
                    <button
                      onClick={handleSaveCurrentTree}
                      disabled={!analysisBundle || loading || treeBank.saving}
                      className={`flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap ${
                        treeBank.saveSuccess
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                          : 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed'
                      }`}
                      title={analysisBundle ? 'Save current analysis to Tree Bank' : 'Parse a sentence before saving'}
                    >
                      {treeBank.saveSuccess ? <Check size={12} /> : <Archive size={12} />}
                      {treeBank.saving ? 'Saving...' : treeBank.saveSuccess ? 'Saved' : 'Save to Tree Bank'}
                    </button>
                  )}

                  <TreeBankToggle open={isTreeBankView} count={treeBank.entries.length} onToggle={toggleTreeBank} />

                  {!isTreeBankView && (
                    <ModelControls models={models} lastModelUsed={analysisBundle?.modelUsed} disabled={loading} />
                  )}

                  <FullscreenButton fullscreen={isFullscreen} onToggle={toggleFullscreen} />
                </div>
              </div>
            </div>
        </div>
      </header>

      {fullscreenError && (
        <p role="alert" className="shrink-0 border-b border-rose-500/30 bg-[#261114] px-4 py-3 text-rose-200 text-sm">
          {fullscreenError}
        </p>
      )}

      {!isTreeBankView && treeBank.error && (
        <div role="alert" className="shrink-0 border-b border-rose-500/30 bg-[#261114] px-4 py-3 text-rose-200 text-sm">
          {treeBank.error}
        </div>
      )}
      <main data-babel-workspace="true" className="flex-1 relative flex flex-col overflow-hidden">
        {isTreeBankView ? (
          <ViewErrorBoundary resetKey={viewResetKey} message="Your saved analyses are unchanged.">
            <TreeBankView
              entries={treeBank.entries} loading={treeBank.loading} error={treeBank.error}
              opening={treeBank.opening} onOpen={handleOpenTreeBankEntry} onDelete={treeBank.setPendingDelete}
            />
          </ViewErrorBoundary>
        ) : (
          <>
            {showsTree && hasAmbiguity && (
              <ParseChoices count={analysisBundle?.analyses.length ?? 0} active={activeParseIndex} onChoose={changeParse} />
            )}

            <div className="absolute inset-0 z-0">
              <ViewErrorBoundary resetKey={viewResetKey}>
                {loading && <GenerationLoading structures={framework === 'xbar' ? 'X-Bar' : 'Minimalist'} />}

                {!loading && showsTree && activeParse && activeDisplay?.displayTree ? (
                  <TreeVisualizer
                    initialReplayStep={initialReplayPosition ?? undefined}
                    autoPlay={initialReplayPosition === null}
                    onReplayStepChange={rememberReplayPosition}
                    data={activeDisplay.displayTree}
                    animated
                    derivationStages={activeParse.derivationStages}
                    abstractionMode={abstractionMode}
                    sentence={activeParse.sentenceCheck?.treeReading ?? parsedSentence}
                    inputTokens={activeDisplay.inputTokens}
                    sentenceCheck={activeParse.sentenceCheck}
                  />
                ) : !loading && <EmptyWorkspace />}
              </ViewErrorBoundary>
            </div>

            {!showsTree && (
              <SentenceBar
                inputRef={sentenceInputRef}
                value={input}
                onChange={setInput}
                onSubmit={() => void handleParse()}
                loading={loading}
                placeholder={`Plant a ${framework === 'xbar' ? 'Generative' : 'Minimalist'} linguistic seed...`}
                error={error}
                onDismiss={dismissShownFailure}
                failureNotice={needsKey && (
                  <div className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-200">
                    <Key size={12} />
                    External API Key Required
                  </div>
                )}
              />
            )}
          </>
        )}

        {treeBank.pendingDelete && (
          <TreeBankDeleteDialog entry={treeBank.pendingDelete} onConfirm={treeBank.deletePending} onCancel={() => treeBank.setPendingDelete(null)} />
        )}

      </main>

      {!isFullscreen && (
      <footer className="bg-black/80 py-4 px-10 shrink-0 z-40">
        <div className="max-w-[2000px] mx-auto flex items-center justify-end text-[8px] font-black text-emerald-900/50 uppercase tracking-[0.5em]">
          <div className="flex items-center gap-6">
            {needsKey && (
              <div className="flex items-center gap-2 text-amber-400/80">
                <Key size={10} /> External API Key Required
              </div>
            )}
            <div className="italic serif lowercase text-[10px] tracking-normal text-emerald-500/75">
              rooted in {framework === 'xbar' ? 'generative grammar' : 'minimalist principles'} and neural synthesis
            </div>
          </div>
        </div>
      </footer>
      )}
    </div>
  );
};

export default App;
