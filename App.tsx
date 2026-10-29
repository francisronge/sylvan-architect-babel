import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useGeneration } from './hooks/useGeneration';
import { submittedGenerationRequest } from './services/generationState';
import { useSporeDrift, type Spore } from './hooks/useSporeDrift';
import { captureVisibleTreeSnapshot } from './services/treeSnapshot';
import { deriveAnalysisDisplay } from './services/analysisDisplay';
import { useTreeBank } from './hooks/useTreeBank';
import { useDevPreview, type DevAnalysisOptions, type SavedPreview } from './hooks/useDevPreview';
import type { TreeBankEntrySummary } from './services/treeBankStore';
import { TreeBankView, TreeBankDeleteDialog } from './components/TreeBankView';
import { DerivationNotesView, type CopyStatus } from './components/DerivationNotesView';
import { copyTextToClipboard } from './services/clipboard';
import {
  ParseBundle,
  ParseResult
} from './types';
import TreeVisualizer from './components/AsyncTreeVisualizer';
import RootLogo from './components/RootLogo';
import LoadingMark from './components/LoadingMark';
import FailurePanel from './components/FailurePanel';
import { submitsSentence } from './components/sentenceSubmitKey';
import { GENERATION_MODEL_IDS, getResearchModel } from './server/babelParser/researchModelCatalog.js';
import { 
  RotateCcw, 
  Sparkles,
  Layers,
  Zap,
  Brain,
  FileText,
  ChevronUp,
  ChevronDown,
  FlameKindling,
  Key,
  Triangle,
  EyeOff,
  Maximize2,
  Minimize2,
  Check,
  Archive
} from 'lucide-react';

type AppTab = 'tree' | 'derivation' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'derivation', icon: FlameKindling, label: 'Derivation Replay' },
  { id: 'notes', icon: FileText, label: 'Notes' },
];

const formatModelLabel = (modelUsed: string | undefined, models = GENERATION_MODEL_IDS.map(id => getResearchModel(id)!)): string => {
  const model = String(modelUsed || '').trim();
  if (!model) return 'Model unavailable';
  const catalogModel = models.find((entry) => entry.providerModel === model);
  if (catalogModel) return catalogModel.label;
  if (/^gpt/i.test(model)) return model.toUpperCase();
  if (/^claude/i.test(model)) return model.replace(/^claude/i, 'Claude');
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

type ModelMode = string;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

const MODEL_ACCENT_COLORS: Record<string, string> = {
  'openai:gpt-6.1-sol': '#f6bf69',
  'openai:gpt-6-astra': '#eef59a',
  'openai:gpt-6-sol': '#f6bf69',
  'anthropic:claude-opus-5': '#d8ac86',
  'anthropic:claude-fable-5-1': '#93baf3',
  'moonshot:kimi-k3': '#8ebfba',
  'xai:grok-4.6': '#d7dce2'
};

const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
  ultra: 'Ultra'
};

const REASONING_PILL_STYLES: Record<ReasoningEffort, string> = {
  none: 'border-white/20 bg-white/5 text-white/70',
  minimal: 'border-slate-500/35 bg-slate-500/10 text-slate-200 shadow-[0_0_16px_rgba(148,163,184,0.12)]',
  low: 'border-cyan-700/35 bg-cyan-950/20 text-cyan-200 shadow-[0_0_16px_rgba(8,145,178,0.14)]',
  medium: 'border-teal-500/45 bg-teal-500/15 text-teal-200 shadow-[0_0_16px_rgba(20,184,166,0.16)]',
  high: 'border-[#b7791f]/55 bg-[#b7791f]/24 text-[#f3c777] shadow-[0_0_18px_rgba(183,121,31,0.22)]',
  xhigh: 'border-orange-500/60 bg-orange-500/20 text-orange-200 shadow-[0_0_20px_rgba(249,115,22,0.22)]',
  max: 'border-[#dc2626]/70 bg-[#7f1d1d]/36 text-[#fecaca] shadow-[0_0_22px_rgba(220,38,38,0.28)]',
  ultra: 'border-[#dc2626]/70 bg-[#7f1d1d]/36 text-[#fecaca] shadow-[0_0_22px_rgba(220,38,38,0.28)]'
};

const coerceReasoningEffortForRoute = (route: ModelMode, value?: string): ReasoningEffort => {
  const control = getResearchModel(route)!.controls[0];
  return (control.values.includes(value || '') ? value : control.qualificationDefault) as ReasoningEffort;
};

type WorkspaceView = 'arboretum' | 'treeBank';
interface AppProps {
  /** Local harnesses can offer their own catalog subset without changing public provider routes. */
  modelIds?: readonly string[];
}

const App: React.FC<AppProps> = ({ modelIds = GENERATION_MODEL_IDS }) => {
  const MODEL_OPTIONS = useMemo(() => modelIds.map(id => getResearchModel(id)!), [modelIds]);
  const DEFAULT_MODEL_ID = modelIds[0];
  const coerceModelRoute = useCallback((value?: string): ModelMode =>
    modelIds.includes(value || '') ? value! : DEFAULT_MODEL_ID, [modelIds, DEFAULT_MODEL_ID]);
  const inferModelRouteFromModel = useCallback((modelUsed?: string): ModelMode =>
    MODEL_OPTIONS.find(model => model.providerModel === modelUsed)?.id || DEFAULT_MODEL_ID, [MODEL_OPTIONS, DEFAULT_MODEL_ID]);
  const appContainerRef = useRef<HTMLDivElement>(null);
  const copyStatusTimeoutRef = useRef<number | null>(null);
  const copyAttemptRef = useRef(0);
  const showcaseMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const value = new URLSearchParams(window.location.search).get('showcase');
    return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  }, []);
  const spores = useMemo<Spore[]>(
    () =>
      Array.from({ length: 12 }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 24,
        duration: 20 + Math.random() * 16,
        drift: 40 + Math.random() * 120
      })),
    []
  );
  const sporeLayerRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('The farmer eats the pig');
  // A failure and its downloads stay until the next generation starts, also
  // while the model or effort for that next request is being chosen.
  const { loading, error, needsKey, generate, clearFailure, resetGeneration, reportError } = useGeneration();
  useSporeDrift(sporeLayerRef, spores, loading);
  const [analysisBundle, setAnalysisBundle] = useState<ParseBundle | null>(null);
  const [activeParseIndex, setActiveParseIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<AppTab>('tree');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isInputVisible, setIsInputVisible] = useState(!showcaseMode);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [parsedFramework, setParsedFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [modelRoute, setModelRoute] = useState<ModelMode>(DEFAULT_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
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
  const activeDisplayTree = activeDisplay?.displayTree ?? null;
  const milesNotation = activeDisplay?.notation ?? '';
  const derivationalNoteParagraphs = activeDisplay?.stageRecords ?? [];
  const hasAmbiguity = (analysisBundle?.analyses?.length ?? 0) > 1;
  const selectedModel = getResearchModel(modelRoute)!;
  const selectedModelLabel = selectedModel.label;
  const modelLabel = formatModelLabel(analysisBundle?.modelUsed, MODEL_OPTIONS);
  const activeReasoningEffort = coerceReasoningEffortForRoute(modelRoute, reasoningEffort);
  const activeReasoningOptions = selectedModel.controls[0].values as ReasoningEffort[];
  const reasoningControlLabel = selectedModel.controls[0].label;
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  // Replay gives the input bar's space to the tree and its panel; a new sentence
  // is entered from Canopy or Notes. A running generation or a failure keeps the
  // bar, because it carries their progress and diagnostics.
  const hideInputForReplay = activeTab === 'derivation' && Boolean(activeParse) && !loading && !error;
  const acceptDevAnalysis = useCallback((bundle: ParseBundle, options: DevAnalysisOptions) => {
    setInitialReplayPosition(null);
    setAnalysisBundle(bundle);
    const nextSentence = String(options.sentence || '').trim();
    if (nextSentence) {
      setParsedSentence(nextSentence);
      setInput(nextSentence);
    }
    if (options.framework) setFramework(options.framework);
    setParsedFramework(options.framework || bundle.analyses[0]?.provenance?.framework || 'xbar');
    if (options.modelRoute) {
      const nextRoute = coerceModelRoute(options.modelRoute);
      setModelRoute(nextRoute);
      setReasoningEffort(coerceReasoningEffortForRoute(nextRoute, options.reasoningEffort || reasoningEffort));
    } else if (options.reasoningEffort) {
      setReasoningEffort(coerceReasoningEffortForRoute(modelRoute, options.reasoningEffort));
    }
    setActiveParseIndex(0);
    setActiveTab('tree');
    resetCopyStatus();
    setIsInputVisible(true);
    setIsInputExpanded(true);
    setWorkspaceView('arboretum');
    resetGeneration();
  }, [modelRoute, reasoningEffort, coerceModelRoute, resetGeneration, resetCopyStatus]);

  const acceptSavedPreview = useCallback((preview: SavedPreview) => {
    const { bundle, sentence, framework: nextFramework, tab, captureMode } = preview;
    const nextRoute = coerceModelRoute(preview.modelRoute || inferModelRouteFromModel(bundle.modelUsed));
    setInitialReplayPosition(null);
    setAnalysisBundle(bundle);
    setParsedSentence(sentence);
    setInput(sentence);
    setFramework(nextFramework);
    setParsedFramework(nextFramework);
    setModelRoute(nextRoute);
    setReasoningEffort(coerceReasoningEffortForRoute(nextRoute, preview.reasoningEffort || reasoningEffort));
    setActiveParseIndex(0);
    setActiveTab(tab);
    resetCopyStatus();
    setWorkspaceView('arboretum');
    resetGeneration();
    setIsInputVisible(!(showcaseMode || captureMode));
    setIsInputExpanded(!(showcaseMode || captureMode));
  }, [showcaseMode, reasoningEffort, coerceModelRoute, inferModelRouteFromModel, resetGeneration, resetCopyStatus]);

  const devCaptureMode = useDevPreview({
    analysisBundle,
    onAnalysis: acceptDevAnalysis,
    onPreview: acceptSavedPreview,
    onTab: setActiveTab,
    onInputVisibility: setIsInputVisible,
    onError: reportError
  });

  useEffect(() => {
    setReasoningEffort((current) => coerceReasoningEffortForRoute(modelRoute, current));
  }, [modelRoute]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
      });
      window.setTimeout(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        window.dispatchEvent(new Event('resize'));
      }, 80);
    };

    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
    };
  }, []);

  const handleParse = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    const request = submittedGenerationRequest(input, {
      framework,
      modelId: modelRoute,
      settings: { [selectedModel.controls[0].id]: activeReasoningEffort }
    });
    if (!request) return;

    setInitialReplayPosition(activeParse ? replayPositions.current.get(activeParse) ?? null : null);
    await generate(request, data => {
      setInitialReplayPosition(null);
      setAnalysisBundle(data);
      const nextModelRoute = coerceModelRoute(data.requestedModelId || modelRoute);
      setModelRoute(nextModelRoute);
      setReasoningEffort(coerceReasoningEffortForRoute(nextModelRoute, data.requestedReasoningEffort || activeReasoningEffort));
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
      const nextModelRoute = coerceModelRoute(bundle.requestedModelId || inferModelRouteFromModel(bundle.modelUsed));
      setModelRoute(nextModelRoute);
      setReasoningEffort(coerceReasoningEffortForRoute(nextModelRoute, bundle.requestedReasoningEffort || reasoningEffort));
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

  const toggleFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      setFullscreenError('The browser blocked fullscreen. Select this tab and try again, or use the browser\'s fullscreen command.');
      console.error('Fullscreen toggle failed', err);
    }
  };

  return (
    <div
      ref={appContainerRef}
      className={`app-shell flex flex-col overflow-hidden selection:bg-emerald-500 selection:text-white ${
        isFullscreen ? 'is-fullscreen' : ''
      }`}
    >
      <div className="god-rays"></div>
      <div ref={sporeLayerRef} className="spore-layer" aria-hidden="true">
        {spores.map((spore, idx) => (
          <div key={idx} className="spore" style={{ left: `${spore.left}vw` }} />
        ))}
      </div>
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-4 py-3 md:px-8 md:py-4 shrink-0 shadow-2xl">
        <div className="w-full flex flex-wrap min-[1600px]:flex-nowrap items-center gap-3 md:gap-6">
            <div className="flex items-center gap-3 md:gap-4 shrink-0">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,78,59,0.5)]">
                <RootLogo size={40} shape="square" blend={true} zoom={1.12} className="w-full h-full" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white serif leading-tight">Sylvan Architect Babel</h1>
                <p className="text-[6px] md:text-[7px] font-black uppercase tracking-[0.35em] md:tracking-[0.5em] text-emerald-500/80 leading-none">Generative Grammar Arboretum</p>
              </div>
            </div>

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
                          : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
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

                  <button
                    onClick={toggleTreeBank}
                    className={`flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap ${
                      isTreeBankView
                        ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30'
                    }`}
                    title={isTreeBankView ? 'Return to Arboretum' : 'Open Tree Bank'}
                  >
                    <Archive size={12} />
                    {isTreeBankView ? 'Back to Arboretum' : `Tree Bank (${treeBank.entries.length})`}
                  </button>

                  {!isTreeBankView && (
                    <div
                      className="flex flex-wrap xl:contents items-center gap-2"
                      title={
                        analysisBundle?.modelUsed
                          ? `Selected model: ${selectedModelLabel}. Last parse used: ${modelLabel}.`
                          : 'Choose parsing model'
                      }
                    >
                      <label
                        className="flex xl:grow items-center gap-2 px-3 py-2 rounded-lg border"
                        style={{
                          color: MODEL_ACCENT_COLORS[modelRoute],
                          backgroundColor: `${MODEL_ACCENT_COLORS[modelRoute]}1f`,
                          borderColor: `${MODEL_ACCENT_COLORS[modelRoute]}80`,
                          boxShadow: `0 0 16px ${MODEL_ACCENT_COLORS[modelRoute]}22`
                        }}
                      >
                        <Zap size={10} className="fill-current" />
                        <select
                          aria-label="Generation model"
                          value={modelRoute}
                          disabled={loading}
                          onChange={(event) => {
                            setModelRoute(event.target.value);
                            setReasoningEffort('high');
                          }}
                          className="w-40 xl:grow bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
                        >
                          {MODEL_OPTIONS.map((model) => (
                            <option key={model.id} value={model.id} className="bg-[#061810]" style={{ color: MODEL_ACCENT_COLORS[model.id] }}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`flex xl:grow items-center gap-2 px-3 py-2 rounded-lg border ${REASONING_PILL_STYLES[activeReasoningEffort]}`} title={reasoningControlLabel}>
                        <Brain size={10} className="fill-current" />
                        <select
                          aria-label={reasoningControlLabel}
                          value={activeReasoningEffort}
                          disabled={loading}
                          onChange={(event) => {
                            setReasoningEffort(event.target.value as ReasoningEffort);
                          }}
                          className="w-24 xl:grow bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
                        >
                          {activeReasoningOptions.map((effort) => <option key={effort} value={effort} className="bg-[#061810]">{REASONING_EFFORT_LABELS[effort]}</option>)}
                        </select>
                      </label>
                    </div>
                  )}

                  <button
                    onClick={toggleFullscreen}
                    className="flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap"
                    title="Toggle Fullscreen"
                  >
                    {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>
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
          <TreeBankView
            entries={treeBank.entries} loading={treeBank.loading} error={treeBank.error}
            opening={treeBank.opening} onOpen={handleOpenTreeBankEntry} onDelete={treeBank.setPendingDelete}
          />
        )}

        {!isTreeBankView && hasAmbiguity && (
          <div data-babel-tree-controls="top" className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
            <div className="flex max-w-[min(92vw,64rem)] flex-wrap items-center justify-center gap-2 p-1 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-lg shadow-2xl">
              {(analysisBundle?.analyses || []).map((_, parseIndex) => (
                <button
                  key={`parse-choice-${parseIndex}`}
                  aria-pressed={activeParseIndex === parseIndex}
                  onClick={() => changeParse(parseIndex)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    activeParseIndex === parseIndex
                      ? 'moss-gradient text-white border border-emerald-400/50'
                      : 'text-white/60 hover:text-emerald-300'
                  }`}
                >
                  Parse {parseIndex + 1}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isTreeBankView && (
        <div className="absolute inset-0 z-0">
          {loading && (
            <div className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center gap-10 animate-in fade-in duration-700">
              <LoadingMark />
              <div role="status" className="text-center z-10 min-h-[88px] flex flex-col justify-start">
                <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
                <p className="text-emerald-500/40 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {framework === 'xbar' ? 'X-Bar' : 'Minimalist'} Structures</p>
              </div>
            </div>
          )}

          {!loading && activeParse && activeDisplayTree && (activeTab === 'tree' || activeTab === 'derivation') ? (
            <TreeVisualizer
              initialReplayStep={initialReplayPosition ?? undefined}
              autoPlay={initialReplayPosition === null}
              onReplayStepChange={rememberReplayPosition}
              data={activeDisplayTree}
              animated={activeTab === 'derivation'}
              derivationStages={activeParse.derivationStages}
              jevReadings={activeParse.jevReadings}
              abstractionMode={abstractionMode}
              sentence={parsedSentence}
              inputTokens={replayInputTokens}
            />
          ) : activeParse && activeTab === 'notes' ? (
            <DerivationNotesView paragraphs={derivationalNoteParagraphs} notation={milesNotation} copyStatus={copyStatus} onCopy={(text) => void copyNotation(text)} />
          ) : !loading && (
            <div className="w-full h-full flex flex-col items-center justify-center text-emerald-900/10 gap-10">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150"></div>
                <div className="relative z-10 w-24 h-24 md:w-32 md:h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
                  <RootLogo size={104} shape="circle" blend={true} zoom={0.92} className="w-[78px] h-[78px] md:w-[104px] md:h-[104px]" />
                </div>
              </div>
              <div className="text-center z-10 min-h-[88px] flex flex-col justify-start">
                <p className="font-extrabold text-white text-2xl md:text-3xl mono mb-3 tracking-tighter">Awaiting Structural Genesis</p>
                <p className="text-emerald-900 font-black uppercase text-[9px] md:text-[10px] tracking-[0.5em] md:tracking-[0.8em] opacity-80 text-balance max-w-lg mx-auto px-4">Cast a thought into the generative soil to begin its derivation.</p>
              </div>
            </div>
          )}
        </div>
        )}

        {!isTreeBankView && (
          <>
            {/* Navigation Sidebar */}
            <div data-babel-tree-controls="right" className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3 md:gap-4">
              {NAV_TABS.map((tab) => (
                <button
                  key={tab.id}
                  disabled={!activeParse}
                  onClick={() => changeTab(tab.id)}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  className={`group relative w-11 h-11 md:w-14 md:h-14 rounded-2xl flex items-center justify-center transition-all border shadow-2xl disabled:opacity-20 disabled:cursor-not-allowed ${
                    activeTab === tab.id
                    ? 'moss-gradient text-white border-emerald-400/50 shadow-[0_0_20px_rgba(6,78,59,0.4)] scale-110'
                    : 'glass-dark text-emerald-600/60 border-white/5 hover:text-emerald-400 hover:border-white/10 hover:scale-105'
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
                        >
                          {needsKey && (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-200">
                              <Key size={12} />
                              External API Key Required
                            </div>
                          )}
                        </FailurePanel>
                      )}

                      <form onSubmit={handleParse} className="flex gap-3 md:gap-4 items-end">
                        <div className="flex-1 relative">
                          <textarea
                            aria-label="Sentence to analyze"
                            className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 md:p-4 text-emerald-50 serif italic placeholder:text-emerald-900/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all resize-none h-16 md:h-20 text-base md:text-lg shadow-inner leading-relaxed"
                            placeholder={`Plant a ${framework === 'xbar' ? 'Generative' : 'Minimalist'} linguistic seed...`}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (submitsSentence(e)) {
                                e.preventDefault();
                                void handleParse();
                              }
                            }}
                            disabled={loading}
                          />
                        </div>
                        <button
                          type="submit"
                          aria-label={loading ? 'Analyzing sentence' : 'Analyze sentence'}
                          disabled={loading}
                          className="moss-gradient hover:brightness-110 disabled:opacity-40 text-white font-black w-16 h-16 md:w-20 md:h-20 rounded-2xl flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.4)] active:scale-90 transition-all group shrink-0"
                        >
                          {loading ? (
                            <RotateCcw className="animate-spin" size={20} />
                          ) : (
                            <Sparkles size={20} className="group-hover:rotate-12 group-hover:scale-110 transition-transform md:w-6 md:h-6" />
                          )}
                        </button>
                      </form>
                    </div>
                    {!isInputExpanded && (
                      <button type="button" aria-label="Expand Arbor Control" className="w-full px-5 md:px-7 py-3 md:py-4 flex items-center justify-between cursor-pointer group hover:bg-white/5 transition-colors" onClick={() => setIsInputExpanded(true)}>
                        <span className="text-emerald-50/50 serif italic text-xs md:text-sm truncate max-w-[220px] md:max-w-[400px]">"{input}"</span>
                        <span className="text-[8px] font-black text-emerald-500/30 uppercase tracking-[0.4em] group-hover:text-emerald-500 transition-colors">Expand Arbor Control</span>
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
            <div className="italic serif lowercase text-[10px] tracking-normal opacity-40">
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
