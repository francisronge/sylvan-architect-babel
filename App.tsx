import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useGeneration } from './hooks/useGeneration';
import { submittedGenerationRequest } from './services/generationState';
import { captureVisibleTreeSnapshot } from './services/treeSnapshot';
import { deriveAnalysisDisplay } from './services/analysisDisplay';
import { useTreeBank } from './hooks/useTreeBank';
import { useModelSelection } from './hooks/useModelSelection';
import { useFullscreen } from './hooks/useFullscreen';
import { useDevPreview, type DevAnalysisOptions, type SavedPreview } from './hooks/useDevPreview';
import type { TreeBankEntrySummary } from './services/treeBankStore';
import { TreeBankView, TreeBankDeleteDialog } from './components/TreeBankView';
import { DerivationNotesView, type CopyStatus } from './components/DerivationNotesView';
import { copyTextToClipboard } from './services/clipboard';
import {
  ParseBundle,
  ParseResult
} from './types';
import TreeVisualizer, { preloadTreeVisualizer } from './components/LazyTreeVisualizer';
import ViewErrorBoundary from './components/ViewErrorBoundary';
import RootLogo from './components/RootLogo';
import BabelTitle from './components/workspace/BabelTitle';
import { FullscreenButton, TreeBankToggle } from './components/workspace/HeaderButtons';
import SentenceForm from './components/workspace/SentenceForm';
import { EmptyWorkspace, GenerationLoading, ParseChoices } from './components/workspace/WorkspaceStates';
import FailurePanel, { dismissesFailure } from './components/FailurePanel';
import ModelControls from './components/ModelControls';
import ForestBackdrop from './components/ForestBackdrop';
import {
  Layers,
  FileText,
  ChevronUp,
  ChevronDown,
  FlameKindling,
  Key,
  Triangle,
  EyeOff,
  Check,
  Archive
} from 'lucide-react';

type AppTab = 'tree' | 'derivation' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'derivation', icon: FlameKindling, label: 'Derivation Replay' },
  { id: 'notes', icon: FileText, label: 'Notes' },
];

type WorkspaceView = 'arboretum' | 'treeBank';
interface AppProps {
  /** Local harnesses can offer their own catalog subset without changing public provider routes. */
  modelIds?: readonly string[];
}

const App: React.FC<AppProps> = ({ modelIds }) => {
  const models = useModelSelection(modelIds);
  const { modelRoute, reasoningEffort, activeReasoningEffort, inferModelRoute, adoptModel, adoptEffort } = models;
  const copyStatusTimeoutRef = useRef<number | null>(null);
  const copyAttemptRef = useRef(0);
  const showcaseMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const value = new URLSearchParams(window.location.search).get('showcase');
    return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  }, []);
  const sentenceInputRef = useRef<HTMLTextAreaElement>(null);
  const activeTabButtonRef = useRef<HTMLButtonElement>(null);
  const [input, setInput] = useState('The farmer eats the pig');
  // A failure and its downloads stay until the next generation starts or the
  // user dismisses it, also while the model or effort for that next request is
  // being chosen.
  const { loading, error, needsKey, generate, clearFailure, dismissFailure, resetGeneration, reportError } = useGeneration();
  const [analysisBundle, setAnalysisBundle] = useState<ParseBundle | null>(null);
  const [activeParseIndex, setActiveParseIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<AppTab>('tree');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isInputVisible, setIsInputVisible] = useState(!showcaseMode);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('minimalism');
  const [parsedFramework, setParsedFramework] = useState<'xbar' | 'minimalism'>('minimalism');
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const showCopyStatus = useCallback((status: CopyStatus) => {
    if (copyStatusTimeoutRef.current !== null) {
      window.clearTimeout(copyStatusTimeoutRef.current);
      copyStatusTimeoutRef.current = null;
    }
    setCopyStatus(status);
    if (status === 'copied') {
      copyStatusTimeoutRef.current = window.setTimeout(() => {
        setCopyStatus('idle');
        copyStatusTimeoutRef.current = null;
      }, 2000);
    }
  }, []);
  // A later copy or a newly accepted analysis supersedes a pending write's outcome.
  const resetCopyStatus = useCallback(() => {
    copyAttemptRef.current += 1;
    showCopyStatus('idle');
  }, [showCopyStatus]);
  const { isFullscreen, fullscreenError, toggleFullscreen } = useFullscreen();
  const [parsedSentence, setParsedSentence] = useState('The farmer eats the pig');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('arboretum');
  const treeBank = useTreeBank();
  const replayPositions = useRef(new WeakMap<ParseResult, number>());
  const [initialReplayPosition, setInitialReplayPosition] = useState<number | null>(null);
  const activeParse: ParseResult | null = analysisBundle?.analyses?.[activeParseIndex] ?? null;
  const activeDisplay = useMemo(() => analysisBundle && activeParse
    ? deriveAnalysisDisplay(analysisBundle, activeParse, parsedSentence) : null, [analysisBundle, activeParse, parsedSentence]);
  const replayInputTokens = activeDisplay?.inputTokens;
  const rememberReplayPosition = useCallback((step: number) => {
    if (activeParse) replayPositions.current.set(activeParse, step);
  }, [activeParse]);
  const changeTab = (tab: AppTab) => {
    setInitialReplayPosition(activeParse ? replayPositions.current.get(activeParse) ?? null : null);
    setActiveTab(tab);
  };
  const changeParse = (index: number) => {
    const analysis = analysisBundle?.analyses[index];
    setInitialReplayPosition(analysis ? replayPositions.current.get(analysis) ?? null : null);
    setActiveParseIndex(index);
  };
  const toggleTreeBank = () => {
    setInitialReplayPosition(activeParse ? replayPositions.current.get(activeParse) ?? null : null);
    setWorkspaceView(current => current === 'treeBank' ? 'arboretum' : 'treeBank');
  };
  // A view that fails to render shows a retryable notice in its own area; the
  // header, view tabs and sentence bar stay usable and this component keeps the
  // analysis. Choosing another view, parse or analysis clears the notice.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- each selection makes a new key, which resets the boundary.
  const viewResetKey = useMemo(() => ({}), [workspaceView, activeTab, activeParse]);
  const activeDisplayTree = activeDisplay?.displayTree ?? null;
  const milesNotation = activeDisplay?.notation ?? '';
  const derivationalNoteParagraphs = activeDisplay?.stageRecords ?? [];
  const hasAmbiguity = (analysisBundle?.analyses?.length ?? 0) > 1;
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  // Replay gives the input bar's space to the tree and its panel; a new sentence
  // is entered from Canopy or Notes. A running generation or a failure keeps the
  // bar, because it carries their progress and diagnostics, until the failure
  // is dismissed.
  const hideInputForReplay = activeTab === 'derivation' && Boolean(activeParse) && !loading && !error;
  // Dismissal closes only the failure display: the analysis, Parse, paused Replay
  // frame, draft, Tree Bank and footer key notice stay, and nothing is requested.
  // Focus moves to a control that remains, because Replay then removes the bar.
  const dismissShownFailure = () => {
    (activeTab === 'derivation' && activeParse ? activeTabButtonRef : sentenceInputRef).current?.focus();
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
    setActiveTab('tree');
    resetCopyStatus();
    setIsInputVisible(true);
    setIsInputExpanded(true);
    setWorkspaceView('arboretum');
    resetGeneration();
  }, [reasoningEffort, adoptModel, adoptEffort, resetGeneration, resetCopyStatus]);

  const acceptSavedPreview = useCallback((preview: SavedPreview) => {
    const { bundle, sentence, framework: nextFramework, tab, captureMode } = preview;
    setInitialReplayPosition(null);
    setAnalysisBundle(bundle);
    setParsedSentence(sentence);
    setInput(sentence);
    setFramework(nextFramework);
    setParsedFramework(nextFramework);
    adoptModel(preview.modelRoute || inferModelRoute(bundle.modelUsed), preview.reasoningEffort || reasoningEffort);
    setActiveParseIndex(0);
    setActiveTab(tab);
    resetCopyStatus();
    setWorkspaceView('arboretum');
    resetGeneration();
    setIsInputVisible(!(showcaseMode || captureMode));
    setIsInputExpanded(!(showcaseMode || captureMode));
  }, [showcaseMode, reasoningEffort, adoptModel, inferModelRoute, resetGeneration, resetCopyStatus]);

  const devCaptureMode = useDevPreview({
    analysisBundle,
    onAnalysis: acceptDevAnalysis,
    onPreview: acceptSavedPreview,
    onTab: setActiveTab,
    onInputVisibility: setIsInputVisible,
    onError: reportError
  });

  // The tree view is a separate chunk; fetch it once the first screen is up.
  useEffect(() => { preloadTreeVisualizer().catch(() => {}); }, []);

  useEffect(() => {
    return () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
    };
  }, []);

  const handleParse = async () => {
    if (loading) return;
    const request = submittedGenerationRequest(input, {
      framework,
      modelId: modelRoute,
      settings: models.requestSettings
    });
    if (!request) return;

    setInitialReplayPosition(activeParse ? replayPositions.current.get(activeParse) ?? null : null);
    await generate(request, data => {
      setInitialReplayPosition(null);
      setAnalysisBundle(data);
      adoptModel(data.requestedModelId || modelRoute, data.requestedReasoningEffort || activeReasoningEffort);
      setParsedSentence(request.sentence);
      setParsedFramework(framework);
      setActiveParseIndex(0);
      setActiveTab('tree');
      resetCopyStatus();
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
      view: activeTab,
      replayStep: activeParse ? replayPositions.current.get(activeParse) ?? null : null,
      abstractionMode,
      treeSnapshotDataUrl: captureVisibleTreeSnapshot()
    };

    await treeBank.save(entry);
  };

  const handleOpenTreeBankEntry = async (summary: TreeBankEntrySummary) => {
    if (loading) return;
    await treeBank.open(summary.id, ({ entry, bundle, view, replayStep, abstractionMode: savedAbstraction }) => {
      const selected = bundle.analyses[entry.activeParseIndex];
      if (replayStep !== null) replayPositions.current.set(selected, replayStep);
      setInitialReplayPosition(replayStep);
      setAnalysisBundle(bundle);
      setParsedSentence(entry.sentence);
      setInput(entry.sentence);
      setFramework(entry.framework);
      setParsedFramework(entry.framework);
      adoptModel(bundle.requestedModelId || inferModelRoute(bundle.modelUsed), bundle.requestedReasoningEffort || reasoningEffort);
      setActiveParseIndex(entry.activeParseIndex);
      setActiveTab(view);
      setAbstractionMode(savedAbstraction);
      clearFailure();
      resetCopyStatus();
      setIsInputVisible(true);
      setIsInputExpanded(true);
      setWorkspaceView('arboretum');
    });
  };

  const copyNotation = async (text: string) => {
    if (!text.trim()) return;
    const attempt = ++copyAttemptRef.current;
    const copied = await copyTextToClipboard(text);
    if (attempt === copyAttemptRef.current) showCopyStatus(copied ? 'copied' : 'failed');
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
            <BabelTitle />

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
        {isTreeBankView && (
          <ViewErrorBoundary resetKey={viewResetKey} message="Your saved analyses are unchanged.">
            <TreeBankView
              entries={treeBank.entries} loading={treeBank.loading} error={treeBank.error}
              opening={treeBank.opening} onOpen={handleOpenTreeBankEntry} onDelete={treeBank.setPendingDelete}
            />
          </ViewErrorBoundary>
        )}

        {!isTreeBankView && hasAmbiguity && (
          <ParseChoices count={analysisBundle?.analyses.length ?? 0} active={activeParseIndex} onChoose={changeParse} />
        )}

        {!isTreeBankView && (
        <div className="absolute inset-0 z-0">
          <ViewErrorBoundary resetKey={viewResetKey}>
            {loading && <GenerationLoading structures={framework === 'xbar' ? 'X-Bar' : 'Minimalist'} />}

            {!loading && activeParse && activeDisplayTree && (activeTab === 'tree' || activeTab === 'derivation') ? (
              <TreeVisualizer
                initialReplayStep={initialReplayPosition ?? undefined}
                autoPlay={initialReplayPosition === null}
                onReplayStepChange={rememberReplayPosition}
                data={activeDisplayTree}
                animated={activeTab === 'derivation'}
                derivationStages={activeParse.derivationStages}
                abstractionMode={abstractionMode}
                sentence={activeParse.sentenceCheck?.treeReading ?? parsedSentence}
                inputTokens={replayInputTokens}
                sentenceCheck={activeParse.sentenceCheck}
              />
            ) : activeParse && activeTab === 'notes' ? (
              <DerivationNotesView paragraphs={derivationalNoteParagraphs} notation={milesNotation} copyStatus={copyStatus} onCopy={(text) => void copyNotation(text)} />
            ) : !loading && <EmptyWorkspace />}
          </ViewErrorBoundary>
        </div>
        )}

        {!isTreeBankView && (
          <>
            {/* Navigation Sidebar */}
            <div data-babel-tree-controls="right" className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3 md:gap-4">
              {NAV_TABS.map((tab) => (
                <button
                  key={tab.id}
                  ref={activeTab === tab.id ? activeTabButtonRef : undefined}
                  disabled={!activeParse}
                  onClick={() => changeTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`group relative w-11 h-11 md:w-14 md:h-14 rounded-2xl flex items-center justify-center transition-all border shadow-2xl disabled:opacity-20 disabled:cursor-not-allowed ${
                    activeTab === tab.id
                    ? 'moss-gradient text-white border-emerald-400/50 shadow-[0_0_20px_rgba(6,78,59,0.4)] scale-110'
                    : 'glass-dark text-emerald-600/70 border-white/5 hover:text-emerald-400 hover:border-white/10 hover:scale-105'
                  }`}
                >
                  <tab.icon size={18} className="md:w-[22px] md:h-[22px]" />
                  <span className="absolute right-full mr-5 px-4 py-2 rounded-xl bg-black/90 backdrop-blur-xl text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 opacity-0 group-hover:opacity-100 pointer-events-none transition-all border border-white/10 whitespace-nowrap shadow-2xl translate-x-2 group-hover:translate-x-0">
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>

            {!hideShowcaseInput && !hideInputForReplay && !devCaptureMode && (
              <>
                {/* Input UI. A hidden panel or collapsed body stays mounted for its
                    transition, so inert keeps its controls out of focus order. */}
                <div
                  data-babel-tree-controls="bottom"
                  aria-hidden={!isInputVisible}
                  inert={!isInputVisible}
                  className={`absolute left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 md:px-8 transition-[opacity,transform] duration-700 ${isInputVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}
                  style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                  onKeyDown={(event) => {
                    if (!error || !dismissesFailure(event.nativeEvent)) return;
                    event.preventDefault();
                    dismissShownFailure();
                  }}
                >
                  <div className="glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden">
                    <div className="flex items-center justify-between px-5 md:px-7 py-3 md:py-3.5 border-b border-white/5 bg-black/30">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></div>
                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-emerald-500/80">Arboretum Link</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setIsInputExpanded(!isInputExpanded)}
                          title={isInputExpanded ? "Collapse" : "Expand"}
                          aria-label={isInputExpanded ? "Collapse" : "Expand"}
                          className="p-1.5 hover:bg-white/10 rounded-xl transition-colors text-emerald-500/60"
                        >
                          {isInputExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                        </button>
                        <button
                          onClick={() => setIsInputVisible(false)}
                          title="Hide Control Panel"
                          aria-label="Hide Control Panel"
                          className="p-1.5 hover:bg-rose-500/20 rounded-xl transition-colors text-emerald-500/60 hover:text-rose-400"
                        >
                          <EyeOff size={18} />
                        </button>
                      </div>
                    </div>

                    <div inert={!isInputExpanded} className={`transition-[max-height,opacity,padding] duration-700 ease-in-out ${isInputExpanded ? 'max-h-[350px] opacity-100 p-4 md:p-6 pt-3 md:pt-4' : 'max-h-0 opacity-0'}`}>
                      {error && (
                        <FailurePanel
                          message={error.message}
                          failure={error.failure}
                          rawOutput={error.rawOutput}
                          generationRecord={error.generationRecord}
                          sentence={error.request?.sentence}
                          inputTokens={error.inputTokens}
                          onDismiss={dismissShownFailure}
                        >
                          {needsKey && (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-200">
                              <Key size={12} />
                              External API Key Required
                            </div>
                          )}
                        </FailurePanel>
                      )}

                      <SentenceForm
                        inputRef={sentenceInputRef}
                        value={input}
                        onChange={setInput}
                        onSubmit={() => void handleParse()}
                        loading={loading}
                        placeholder={`Plant a ${framework === 'xbar' ? 'Generative' : 'Minimalist'} linguistic seed...`}
                      />
                    </div>
                    {!isInputExpanded && (
                      <button type="button" aria-label="Expand Arbor Control" className="w-full px-5 md:px-7 py-3 md:py-4 flex items-center justify-between cursor-pointer group hover:bg-white/5 transition-colors" onClick={() => setIsInputExpanded(true)}>
                        <span className="text-emerald-50/50 serif italic text-xs md:text-sm truncate max-w-[220px] md:max-w-[400px]">"{input}"</span>
                        <span className="text-[8px] font-black text-emerald-500/75 uppercase tracking-[0.4em] group-hover:text-emerald-500 transition-colors">Expand Arbor Control</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Restore Logo Trigger */}
                {!isInputVisible && (
                  <button
                    data-babel-tree-controls="bottom"
                    onClick={() => setIsInputVisible(true)}
                    className="absolute left-1/2 -translate-x-1/2 z-50 w-12 h-12 md:w-14 md:h-14 moss-gradient rounded-full flex items-center justify-center text-white shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-110 active:scale-95 transition-all animate-in fade-in slide-in-from-bottom-4 duration-500"
                    style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                    title="Restore Arboretum Link"
                    aria-label="Restore Arboretum Link"
                  >
                    <RootLogo size={34} shape="circle" blend={true} zoom={0.92} className="w-7 h-7 md:w-[34px] md:h-[34px]" />
                  </button>
                )}
              </>
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
