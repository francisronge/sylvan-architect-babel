import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseSentence, ParseServiceError } from './services/parseService';
import {
  ParseBundle,
  GenerationRecord,
  ParseFailure,
  ParseResult,
  RawOutputArtifact,
  SyntaxNode
} from './types';
import TreeVisualizer from './components/AsyncTreeVisualizer';
import RootLogo from './components/RootLogo';
import LoadingMark from './components/LoadingMark';
import FailurePanel from './components/FailurePanel';
import { collectDerivationStageRecords } from './derivationNotes.js';
import { GENERATION_MODEL_IDS, getResearchModel } from './server/babelParser/researchModelCatalog.js';
import { collectPronouncedTerminalSequence } from './replay/pronouncedTerminals.ts';
import {
  createTreeBankBundleSnapshot,
  loadTreeBankBundleSnapshot
} from './treeBankSnapshot.js';
import { 
  RotateCcw, 
  Sparkles,
  Layers,
  Zap,
  Info,
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
  Copy,
  Check,
  ExternalLink,
  Archive,
  Trash2,
  FolderOpen,
  Clock3
} from 'lucide-react';

type AppTab = 'tree' | 'derivation' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'derivation', icon: FlameKindling, label: 'Derivation Replay' },
  { id: 'notes', icon: FileText, label: 'Notes' },
];

const KEY_ERROR_CODES = new Set(['API_KEY_EXPIRED', 'API_KEY_MISSING', 'API_KEY_INVALID']);

interface UiErrorState {
  message: string;
  code?: string;
  failure?: ParseFailure;
  rawOutput?: RawOutputArtifact;
  generationRecord?: GenerationRecord;
}

const resolveUiError = (err: unknown): {
  needsKey: boolean;
  error: UiErrorState;
} => {
  const message = err instanceof Error ? err.message : String(err || '');
  const code = err instanceof ParseServiceError ? err.code : '';
  if (KEY_ERROR_CODES.has(code || message)) {
    return {
      needsKey: true,
      error: {
        message: 'The selected provider API key is missing or invalid on the server.',
        code: code || message,
        ...(err instanceof ParseServiceError && err.failure ? { failure: err.failure } : {}),
        ...(err instanceof ParseServiceError && err.rawOutput ? { rawOutput: err.rawOutput } : {}),
        ...(err instanceof ParseServiceError && err.generationRecord ? { generationRecord: err.generationRecord } : {})
      }
    };
  }

  return {
    needsKey: false,
    error: {
      message: message || 'Derivation interrupted.',
      ...(code ? { code } : {}),
      ...(err instanceof ParseServiceError && err.failure ? { failure: err.failure } : {}),
      ...(err instanceof ParseServiceError && err.rawOutput ? { rawOutput: err.rawOutput } : {}),
      ...(err instanceof ParseServiceError && err.generationRecord ? { generationRecord: err.generationRecord } : {})
    }
  };
};

const formatModelLabel = (modelUsed?: string): string => {
  const model = String(modelUsed || '').trim();
  if (!model) return 'Model unavailable';
  const catalogModel = MODEL_OPTIONS.find((entry) => entry.providerModel === model);
  if (catalogModel) return catalogModel.label;
  if (/^gpt/i.test(model)) return model.toUpperCase();
  if (/^claude/i.test(model)) return model.replace(/^claude/i, 'Claude');
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

type ModelMode = string;
type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MODEL_OPTIONS = GENERATION_MODEL_IDS.map((id) => getResearchModel(id)!);
const DEFAULT_MODEL_ID = GENERATION_MODEL_IDS[0];

const MODEL_ACCENT_COLORS: Record<string, string> = {
  'openai:gpt-6-astra': '#eef59a',
  'openai:gpt-5.6-sol': '#f6bf69',
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
  max: 'Max'
};

const REASONING_PILL_STYLES: Record<ReasoningEffort, string> = {
  none: 'border-white/20 bg-white/5 text-white/70',
  minimal: 'border-slate-500/35 bg-slate-500/10 text-slate-200 shadow-[0_0_16px_rgba(148,163,184,0.12)]',
  low: 'border-cyan-700/35 bg-cyan-950/20 text-cyan-200 shadow-[0_0_16px_rgba(8,145,178,0.14)]',
  medium: 'border-teal-500/45 bg-teal-500/15 text-teal-200 shadow-[0_0_16px_rgba(20,184,166,0.16)]',
  high: 'border-[#b7791f]/55 bg-[#b7791f]/24 text-[#f3c777] shadow-[0_0_18px_rgba(183,121,31,0.22)]',
  xhigh: 'border-orange-500/60 bg-orange-500/20 text-orange-200 shadow-[0_0_20px_rgba(249,115,22,0.22)]',
  max: 'border-[#dc2626]/70 bg-[#7f1d1d]/36 text-[#fecaca] shadow-[0_0_22px_rgba(220,38,38,0.28)]'
};

const coerceReasoningEffortForRoute = (route: ModelMode, value?: string): ReasoningEffort => {
  const control = getResearchModel(route)!.controls[0];
  return (control.values.includes(value || '') ? value : control.qualificationDefault) as ReasoningEffort;
};

const coerceModelRoute = (value?: string): ModelMode => {
  return GENERATION_MODEL_IDS.includes(value || '') ? value! : DEFAULT_MODEL_ID;
};

const inferModelRouteFromModel = (modelUsed?: string): ModelMode => {
  return MODEL_OPTIONS.find((model) => model.providerModel === modelUsed)?.id || DEFAULT_MODEL_ID;
};

type MilesMode = 'canopy' | 'derivation';
type CopyCodeKey = 'canopy' | 'derivation';
type WorkspaceView = 'arboretum' | 'treeBank';
type DevReplayTarget = number | 'last' | null;

interface DevBundleConfig {
  bundlePath: string;
  tab: AppTab;
  replayStep: DevReplayTarget;
  captureMode: boolean;
}

interface TreeBankEntry {
  id: string;
  sentence: string;
  framework: 'xbar' | 'minimalism';
  activeParseIndex: number;
  createdAt: string;
  updatedAt: string;
  bundle: ParseBundle;
  treeSnapshotDataUrl?: string;
}

const TREE_BANK_DB_NAME = 'sylvan-architect-babel';
const TREE_BANK_STORE_NAME = 'treeBank';
const TREE_BANK_DB_VERSION = 1;

const compareTreeBankEntries = (a: TreeBankEntry, b: TreeBankEntry): number =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

const createTreeBankId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tree-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatTreeBankDate = (iso: string): string => {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Unknown timestamp';
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const encodeUtf8ToBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const captureVisibleTreeSnapshot = (): string | undefined => {
  if (typeof document === 'undefined') return undefined;

  const svg = document.querySelector('svg[data-babel-tree="true"]') as SVGSVGElement | null;
  if (!svg) return undefined;

  const SNAPSHOT_WIDTH = 1600;
  const SNAPSHOT_HEIGHT = 980;
  const SNAPSHOT_PADDING = 72;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  // An SVG used as an image cannot inherit the application's stylesheet.
  // Keep geometry attributes intact so the snapshot can still be fitted below.
  const paintProperties = [
    'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
    'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'visibility', 'display',
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
    'word-spacing', 'text-anchor', 'dominant-baseline', 'text-transform',
    'text-decoration', 'paint-order', 'vector-effect', 'filter', 'rx', 'ry'
  ];
  const liveElements = [svg, ...svg.querySelectorAll<SVGElement>('*')];
  const clonedElements = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  liveElements.forEach((element, index) => {
    const computed = getComputedStyle(element);
    paintProperties.forEach((property) => {
      clonedElements[index].style.setProperty(property, computed.getPropertyValue(property));
    });
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(SNAPSHOT_WIDTH));
  clone.setAttribute('height', String(SNAPSHOT_HEIGHT));
  clone.setAttribute('viewBox', `0 0 ${SNAPSHOT_WIDTH} ${SNAPSHOT_HEIGHT}`);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bgRect.setAttribute('x', '0');
  bgRect.setAttribute('y', '0');
  bgRect.setAttribute('width', '100%');
  bgRect.setAttribute('height', '100%');
  bgRect.setAttribute('fill', '#020806');
  clone.insertBefore(bgRect, clone.firstChild);

  const liveGroup = svg.querySelector('g');
  const clonedGroup = clone.querySelector('g');
  if (liveGroup && clonedGroup) {
    try {
      let bbox = liveGroup.getBBox();
      if (liveGroup.querySelector('[data-babel-plaque-viewport]')) {
        // SVG getBBox includes clipped text. Measure the visible viewport boxes
        // on a disposable copy, leaving every authored row in the saved image.
        const measurement = clone.cloneNode(true) as SVGSVGElement;
        measurement.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none';
        measurement.querySelectorAll<SVGSVGElement>('[data-babel-plaque-viewport]').forEach(viewport => {
          const box = viewport.viewBox.baseVal;
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          for (const key of ['x', 'y', 'width', 'height'] as const) rect.setAttribute(key, String(box[key]));
          viewport.replaceChildren(rect);
        });
        document.body.appendChild(measurement);
        try { bbox = measurement.querySelector<SVGGElement>('g')!.getBBox(); }
        finally { measurement.remove(); }
      }
      if (Number.isFinite(bbox.width) && Number.isFinite(bbox.height) && bbox.width > 0 && bbox.height > 0) {
        const availableWidth = Math.max(1, SNAPSHOT_WIDTH - SNAPSHOT_PADDING * 2);
        const availableHeight = Math.max(1, SNAPSHOT_HEIGHT - SNAPSHOT_PADDING * 2);
        const scale = Math.min(availableWidth / bbox.width, availableHeight / bbox.height);
        const translateX = (SNAPSHOT_WIDTH - bbox.width * scale) / 2 - bbox.x * scale;
        const translateY = (SNAPSHOT_HEIGHT - bbox.height * scale) / 2 - bbox.y * scale;
        clonedGroup.setAttribute('transform', `translate(${translateX},${translateY}) scale(${scale})`);
      }
    } catch {
      // Use the current rendered transform when SVG bounds are unavailable.
    }
  }

  const serialized = new XMLSerializer().serializeToString(clone);
  return `data:image/svg+xml;base64,${encodeUtf8ToBase64(serialized)}`;
};

const normalizeTreeBankEntry = (value: unknown): TreeBankEntry | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  const id = String(candidate.id || '').trim();
  const sentence = String(candidate.sentence || '').trim();
  const framework = candidate.framework === 'minimalism' ? 'minimalism' : candidate.framework === 'xbar' ? 'xbar' : null;
  const activeParseIndexRaw = Number(candidate.activeParseIndex);
  const activeParseIndex = Number.isInteger(activeParseIndexRaw) && activeParseIndexRaw >= 0 ? activeParseIndexRaw : 0;
  const createdAt = String(candidate.createdAt || '').trim();
  const updatedAt = String(candidate.updatedAt || '').trim();
  const bundle = candidate.bundle
    ? loadTreeBankBundleSnapshot(candidate.bundle) as ParseBundle
    : undefined;
  const snapshotRaw = typeof candidate.treeSnapshotDataUrl === 'string' ? candidate.treeSnapshotDataUrl : '';
  const treeSnapshotDataUrl = snapshotRaw.startsWith('data:image/') ? snapshotRaw : undefined;

  if (!id || !sentence || !framework || !bundle || !Array.isArray(bundle.analyses) || bundle.analyses.length === 0) {
    return null;
  }

  return {
    id,
    sentence,
    framework,
    activeParseIndex,
    createdAt: createdAt || updatedAt || new Date().toISOString(),
    updatedAt: updatedAt || createdAt || new Date().toISOString(),
    bundle,
    treeSnapshotDataUrl
  };
};

const unwrapDevBundlePayload = (value: unknown): ParseBundle | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const response = candidate.response;
  if (response && typeof response === 'object' && Array.isArray((response as unknown as ParseBundle).analyses)) {
    return response as unknown as ParseBundle;
  }
  const result = candidate.result;
  if (result && typeof result === 'object' && Array.isArray((result as unknown as ParseBundle).analyses)) {
    return result as unknown as ParseBundle;
  }
  return Array.isArray((candidate as unknown as ParseBundle).analyses)
    ? candidate as unknown as ParseBundle
    : null;
};

const openTreeBankDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported.'));
      return;
    }

    const request = window.indexedDB.open(TREE_BANK_DB_NAME, TREE_BANK_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TREE_BANK_STORE_NAME)) {
        db.createObjectStore(TREE_BANK_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open Tree Bank database.'));
  });

const listTreeBankEntries = async (): Promise<TreeBankEntry[]> => {
  const db = await openTreeBankDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREE_BANK_STORE_NAME, 'readonly');
    const store = tx.objectStore(TREE_BANK_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const entries = (Array.isArray(request.result) ? request.result : [])
        .map((entry) => normalizeTreeBankEntry(entry))
        .filter((entry): entry is TreeBankEntry => Boolean(entry))
        .sort(compareTreeBankEntries);
      resolve(entries);
    };
    request.onerror = () => reject(request.error || new Error('Failed to load Tree Bank entries.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
};

const saveTreeBankEntry = async (entry: TreeBankEntry): Promise<void> => {
  const db = await openTreeBankDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREE_BANK_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TREE_BANK_STORE_NAME);
    const request = store.put(entry);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to save tree.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
};

const removeTreeBankEntry = async (id: string): Promise<void> => {
  const db = await openTreeBankDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(TREE_BANK_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TREE_BANK_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to delete tree.'));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
};
const KNOWN_CATEGORY_LABELS = new Set([
  'A',
  "A'",
  'ADJ',
  'ADJP',
  'ADVP',
  'ASP',
  "ASP'",
  'ASPP',
  'C',
  "C'",
  'CP',
  'D',
  "D'",
  'DP',
  'I',
  "I'",
  'IP',
  'INFL',
  "INFL'",
  'INFLP',
  'N',
  "N'",
  'NEG',
  "NEG'",
  'NEGP',
  'NP',
  'P',
  "P'",
  'PP',
  'PRT',
  'PRTP',
  'T',
  "T'",
  'TP',
  'V',
  "V'",
  'VP'
]);

const normalizeCategoryToken = (token: string): string =>
  token
    .trim()
    .replace(/’/g, "'")
    .replace(/\s+/g, '')
    .toUpperCase();

const isLikelySyntacticCategory = (label: string): boolean => {
  const raw = label.trim();
  if (!raw) return false;
  const normalized = normalizeCategoryToken(raw);
  if (KNOWN_CATEGORY_LABELS.has(normalized)) return true;
  return /^[A-Z][A-Z0-9]*(?:P|')?$/.test(raw);
};

const sanitizeMilesToken = (token: string): string =>
  token
    .trim()
    .replace(/\s+/g, '_')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')');

const serializeMilesNode = (node: SyntaxNode): string => {
  if (!node || typeof node !== 'object') return '';
  const label = String(node.label || '').trim();
  const word = String(node.word || '').trim();
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
    : [];

  if (children.length === 0) {
    const rawSurface = (word || label || '∅').trim();
    const token = sanitizeMilesToken(rawSurface || '∅');
    if (word) return token;
    if (label && isLikelySyntacticCategory(label)) {
      return `[${sanitizeMilesToken(label)} ${token === sanitizeMilesToken(label) ? '∅' : token}]`;
    }
    return token;
  }

  const serializedChildren = children
    .map((child) => serializeMilesNode(child))
    .filter((value) => value.length > 0);
  const nodeLabel = sanitizeMilesToken(label || word || 'X');
  if (serializedChildren.length === 0) return `[${nodeLabel}]`;
  return `[${nodeLabel} ${serializedChildren.join(' ')}]`;
};

const buildMilesNotation = (
  tree: SyntaxNode,
  _mode: MilesMode
): string => {
  if (!tree || typeof tree !== 'object') return '';
  return serializeMilesNode(tree).trim();
};

const App: React.FC = () => {
  const appContainerRef = useRef<HTMLDivElement>(null);
  const treeBankSaveSuccessTimeoutRef = useRef<number | null>(null);
  const copiedCodeTimeoutRef = useRef<number | null>(null);
  const showcaseMode = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const value = new URLSearchParams(window.location.search).get('showcase');
    return ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  }, []);
  const devBundleConfig = useMemo<DevBundleConfig | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const bundlePath = String(params.get('devBundle') || '').trim();
    if (!bundlePath) return null;
    const rawTab = String(params.get('devTab') || '').trim();
    const tab: AppTab =
      rawTab === 'derivation' || rawTab === 'notes' || rawTab === 'tree' ? rawTab : 'tree';
    const rawReplayStep = String(params.get('devReplayStep') || '').trim().toLowerCase();
    const replayStep: DevReplayTarget =
      rawReplayStep === 'last'
        ? 'last'
        : (rawReplayStep !== '' && Number.isInteger(Number(rawReplayStep)) && Number(rawReplayStep) >= 0
          ? Number(rawReplayStep)
          : null);
    const captureMode = ['1', 'true', 'yes'].includes(String(params.get('devCapture') || '').toLowerCase());
    return { bundlePath, tab, replayStep, captureMode };
  }, []);
  const spores = useMemo(
    () =>
      Array.from({ length: 12 }, () => ({
        left: Math.random() * 100,
        delay: Math.random() * 24,
        duration: 20 + Math.random() * 16,
        drift: 40 + Math.random() * 120
      })),
    []
  );
  const [input, setInput] = useState('The farmer eats the pig');
  const [loading, setLoading] = useState(false);
  const [analysisBundle, setAnalysisBundle] = useState<ParseBundle | null>(null);
  const [activeParseIndex, setActiveParseIndex] = useState(0);
  const [error, setError] = useState<UiErrorState | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('tree');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isInputVisible, setIsInputVisible] = useState(!showcaseMode);
  const [devCaptureMode, setDevCaptureMode] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [modelRoute, setModelRoute] = useState<ModelMode>(DEFAULT_MODEL_ID);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('high');
  const [copiedCodeKey, setCopiedCodeKey] = useState<CopyCodeKey | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [parsedSentence, setParsedSentence] = useState('The farmer eats the pig');
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('arboretum');
  const [treeBankEntries, setTreeBankEntries] = useState<TreeBankEntry[]>([]);
  const [treeBankLoading, setTreeBankLoading] = useState(false);
  const [treeBankError, setTreeBankError] = useState<string | null>(null);
  const [treeBankSaveSuccess, setTreeBankSaveSuccess] = useState(false);
  const [treeBankSaving, setTreeBankSaving] = useState(false);
  const [entryPendingDelete, setEntryPendingDelete] = useState<TreeBankEntry | null>(null);
  const activeParse: ParseResult | null = analysisBundle?.analyses?.[activeParseIndex] ?? null;
  const hasAmbiguity = (analysisBundle?.analyses?.length ?? 0) > 1;
  const selectedModel = getResearchModel(modelRoute)!;
  const selectedModelLabel = selectedModel.label;
  const modelLabel = formatModelLabel(analysisBundle?.modelUsed);
  const activeReasoningEffort = coerceReasoningEffortForRoute(modelRoute, reasoningEffort);
  const activeReasoningOptions = selectedModel.controls[0].values as ReasoningEffort[];
  const reasoningControlLabel = selectedModel.controls[0].label;
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  const canopyMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'canopy');
  }, [activeParse]);
  const derivationMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'derivation');
  }, [activeParse]);
  const derivationalNoteParagraphs = useMemo(() => {
    if (!activeParse) return [];
    return collectDerivationStageRecords(activeParse.derivationStages);
  }, [activeParse]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as any;
    target.__BABEL_DEV_SET_ANALYSIS__ = (bundle: ParseBundle, options: {
      sentence?: string;
      framework?: 'xbar' | 'minimalism';
      modelRoute?: ModelMode;
      reasoningEffort?: ReasoningEffort;
    } = {}) => {
      setAnalysisBundle(bundle);
      const nextSentence = String(options.sentence || '').trim();
      if (nextSentence) {
        setParsedSentence(nextSentence);
        setInput(nextSentence);
      }
      if (options.framework) setFramework(options.framework);
      if (options.modelRoute) {
        const nextRoute = coerceModelRoute(options.modelRoute);
        setModelRoute(nextRoute);
        setReasoningEffort(coerceReasoningEffortForRoute(nextRoute, options.reasoningEffort || reasoningEffort));
      } else if (options.reasoningEffort) {
        setReasoningEffort(coerceReasoningEffortForRoute(modelRoute, options.reasoningEffort));
      }
      setActiveParseIndex(0);
      setActiveTab('tree');
      setError(null);
      setCopiedCodeKey(null);
      setNeedsKey(false);
      setIsInputVisible(true);
      setIsInputExpanded(true);
      setWorkspaceView('arboretum');
      setLoading(false);
    };
    target.__BABEL_DEV_SET_TAB__ = (tab: AppTab) => {
      if (tab === 'tree' || tab === 'derivation' || tab === 'notes') {
        setActiveTab(tab);
      }
    };
    target.__BABEL_DEV_SET_INPUT_VISIBILITY__ = (visible: boolean) => {
      setIsInputVisible(Boolean(visible));
    };
    target.__BABEL_DEV_SET_CAPTURE_MODE__ = (enabled: boolean) => {
      setDevCaptureMode(Boolean(enabled));
    };

    return () => {
      delete target.__BABEL_DEV_SET_ANALYSIS__;
      delete target.__BABEL_DEV_SET_TAB__;
      delete target.__BABEL_DEV_SET_INPUT_VISIBILITY__;
      delete target.__BABEL_DEV_SET_CAPTURE_MODE__;
    };
  }, [modelRoute, reasoningEffort]);

  useEffect(() => {
    setReasoningEffort((current) => coerceReasoningEffortForRoute(modelRoute, current));
  }, [modelRoute]);

  useEffect(() => {
    if (!devBundleConfig) return;
    let cancelled = false;

    const loadDevBundle = async () => {
      try {
        const response = await fetch(devBundleConfig.bundlePath, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const saved = await response.json();
        const bundle = unwrapDevBundlePayload(saved);
        if (!bundle || !Array.isArray(bundle.analyses) || bundle.analyses.length === 0) {
          throw new Error('Saved bundle does not contain analyses.');
        }
        if (cancelled) return;

        const savedRecord = saved && typeof saved === 'object' ? saved as Record<string, any> : {};
        const requestRecord = savedRecord.request && typeof savedRecord.request === 'object'
          ? savedRecord.request as Record<string, any>
          : {};
        const firstAnalysis = bundle.analyses[0];
        const pronouncedTerminalSentence = collectPronouncedTerminalSequence(firstAnalysis?.tree).join(' ');
        const nextSentence =
          String(requestRecord.sentence || savedRecord.sentence || bundle.sentence || '').trim()
          || pronouncedTerminalSentence
          || 'Sentence unavailable';
        const nextFramework = requestRecord.framework === 'minimalism'
          ? 'minimalism'
          : (requestRecord.framework === 'xbar' ? 'xbar' : firstAnalysis?.provenance?.framework === 'minimalism' ? 'minimalism' : 'xbar');
        const nextModelRoute =
          String(requestRecord.modelId || bundle.requestedModelId || '').trim()
          || inferModelRouteFromModel(bundle.modelUsed);
        const coercedModelRoute = coerceModelRoute(nextModelRoute);
        const nextReasoningEffort = String(requestRecord.reasoningEffort || bundle.requestedReasoningEffort || '').trim();

        setAnalysisBundle(bundle);
        setParsedSentence(nextSentence);
        setInput(nextSentence);
        setFramework(nextFramework);
        setModelRoute(coercedModelRoute);
        setReasoningEffort(coerceReasoningEffortForRoute(coercedModelRoute, nextReasoningEffort || reasoningEffort));
        setActiveParseIndex(0);
        setActiveTab(devBundleConfig.tab);
        setError(null);
        setCopiedCodeKey(null);
        setNeedsKey(false);
        setWorkspaceView('arboretum');
        setLoading(false);
        setDevCaptureMode(devBundleConfig.captureMode);
        setIsInputVisible(!(showcaseMode || devBundleConfig.captureMode));
        setIsInputExpanded(!(showcaseMode || devBundleConfig.captureMode));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err || 'Unknown error');
        setError({ message: `Unable to load preview bundle: ${message}` });
      }
    };

    loadDevBundle();
    return () => {
      cancelled = true;
    };
  }, [devBundleConfig, showcaseMode, reasoningEffort]);

  useEffect(() => {
    if (!devBundleConfig || devBundleConfig.replayStep === null || typeof window === 'undefined' || !analysisBundle) {
      return;
    }
    let attempts = 0;
    const target = window as any;
    const timer = window.setInterval(() => {
      const getReplayCount = target.__BABEL_DEV_GET_REPLAY_STEP_COUNT__;
      const setReplayStep = target.__BABEL_DEV_SET_REPLAY_STEP__;
      if (typeof getReplayCount !== 'function' || typeof setReplayStep !== 'function') {
        attempts += 1;
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      const replayCount = Number(getReplayCount()) || 0;
      if (replayCount <= 0) {
        attempts += 1;
        if (attempts > 40) window.clearInterval(timer);
        return;
      }
      const nextStep = devBundleConfig.replayStep === 'last'
        ? replayCount - 1
        : Math.min(Math.max(devBundleConfig.replayStep, 0), replayCount - 1);
      setReplayStep(nextStep);
      window.clearInterval(timer);
    }, 180);

    return () => {
      window.clearInterval(timer);
    };
  }, [analysisBundle, devBundleConfig]);

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
    let cancelled = false;

    const loadTreeBank = async () => {
      setTreeBankLoading(true);
      try {
        const entries = await listTreeBankEntries();
        if (!cancelled) {
          setTreeBankEntries(entries);
          setTreeBankError(null);
        }
      } catch (err) {
        console.error('Tree Bank load failed', err);
        if (!cancelled) {
          setTreeBankError('Tree Bank could not be loaded.');
        }
      } finally {
        if (!cancelled) {
          setTreeBankLoading(false);
        }
      }
    };

    loadTreeBank();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (treeBankSaveSuccessTimeoutRef.current !== null) {
        window.clearTimeout(treeBankSaveSuccessTimeoutRef.current);
      }
      if (copiedCodeTimeoutRef.current !== null) {
        window.clearTimeout(copiedCodeTimeoutRef.current);
      }
    };
  }, []);

  const handleParse = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await parseSentence(input, framework, modelRoute, {
        [selectedModel.controls[0].id]: activeReasoningEffort
      });
      setAnalysisBundle(data);
      const nextModelRoute = coerceModelRoute(data.requestedModelId || modelRoute);
      setModelRoute(nextModelRoute);
      setReasoningEffort(coerceReasoningEffortForRoute(nextModelRoute, data.requestedReasoningEffort || activeReasoningEffort));
      setParsedSentence(input.trim());
      setActiveParseIndex(0);
      setActiveTab('tree');
      setCopiedCodeKey(null);
      setNeedsKey(false);
    } catch (err: unknown) {
      const uiError = resolveUiError(err);
      setNeedsKey(uiError.needsKey);
      setError(uiError.error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentTree = async () => {
    if (!analysisBundle || treeBankSaving || loading) return;

    const sentence = parsedSentence.trim() || input.trim();
    if (!sentence) return;

    const now = new Date().toISOString();
    const snapshot = createTreeBankBundleSnapshot(analysisBundle) as ParseBundle;
    const treeSnapshotDataUrl = captureVisibleTreeSnapshot();
    const entry: TreeBankEntry = {
      id: createTreeBankId(),
      sentence,
      framework,
      activeParseIndex,
      createdAt: now,
      updatedAt: now,
      bundle: snapshot,
      treeSnapshotDataUrl
    };

    setTreeBankSaving(true);
    try {
      await saveTreeBankEntry(entry);
      setTreeBankEntries((current) => [entry, ...current].sort(compareTreeBankEntries));
      setTreeBankSaveSuccess(true);
      setTreeBankError(null);
      if (treeBankSaveSuccessTimeoutRef.current !== null) {
        window.clearTimeout(treeBankSaveSuccessTimeoutRef.current);
      }
      treeBankSaveSuccessTimeoutRef.current = window.setTimeout(() => {
        setTreeBankSaveSuccess(false);
        treeBankSaveSuccessTimeoutRef.current = null;
      }, 2200);
    } catch (err) {
      console.error('Tree Bank save failed', err);
      setTreeBankError('Unable to save this tree to Tree Bank.');
    } finally {
      setTreeBankSaving(false);
    }
  };

  const handleOpenTreeBankEntry = (entry: TreeBankEntry) => {
    const restoredBundle = JSON.parse(JSON.stringify(entry.bundle)) as ParseBundle;
    const parseCount = restoredBundle.analyses?.length ?? 0;
    const nextParseIndex = parseCount > 0
      ? Math.min(Math.max(entry.activeParseIndex, 0), parseCount - 1)
      : 0;

    setAnalysisBundle(restoredBundle);
    setParsedSentence(entry.sentence);
    setInput(entry.sentence);
    setFramework(entry.framework);
    const nextModelRoute = coerceModelRoute(entry.bundle.requestedModelId || inferModelRouteFromModel(entry.bundle.modelUsed));
    setModelRoute(nextModelRoute);
    setReasoningEffort(coerceReasoningEffortForRoute(nextModelRoute, entry.bundle.requestedReasoningEffort || reasoningEffort));
    setActiveParseIndex(nextParseIndex);
    setActiveTab('tree');
    setError(null);
    setCopiedCodeKey(null);
    setNeedsKey(false);
    setIsInputVisible(true);
    setIsInputExpanded(true);
    setWorkspaceView('arboretum');
  };

  const handleDeleteTreeBankEntry = async () => {
    if (!entryPendingDelete) return;
    try {
      await removeTreeBankEntry(entryPendingDelete.id);
      setTreeBankEntries((current) => current.filter((entry) => entry.id !== entryPendingDelete.id));
      setTreeBankError(null);
      setEntryPendingDelete(null);
    } catch (err) {
      console.error('Tree Bank delete failed', err);
      setTreeBankError('Unable to delete this saved tree.');
    }
  };

  const copyMilesCode = (text: string, key: CopyCodeKey) => {
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
    setCopiedCodeKey(key);
    if (copiedCodeTimeoutRef.current !== null) {
      window.clearTimeout(copiedCodeTimeoutRef.current);
    }
    copiedCodeTimeoutRef.current = window.setTimeout(() => {
      setCopiedCodeKey((current) => (current === key ? null : current));
      copiedCodeTimeoutRef.current = null;
    }, 2000);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
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
      <div className={`spore-layer ${loading ? 'paused' : ''}`} aria-hidden="true">
        {spores.map((spore, idx) => (
          <div
            key={idx}
            className="spore"
            style={{
              left: `${spore.left}vw`,
              animationDelay: `-${spore.delay}s`,
              animationDuration: `${spore.duration}s`,
              ['--spore-drift' as any]: `${spore.drift}px`
            }}
          />
        ))}
      </div>
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-4 py-3 md:px-8 md:py-4 shrink-0 shadow-2xl">
        <div className="max-w-[2000px] mx-auto flex flex-wrap items-center gap-3 md:gap-6">
            <div className="flex items-center gap-3 md:gap-4 shrink-0">
              <div className="w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,78,59,0.5)]">
                <RootLogo size={40} shape="square" blend={true} zoom={1.12} className="w-full h-full" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold tracking-tighter text-white serif leading-tight">Sylvan Architect Babel</h1>
                <p className="text-[6px] md:text-[7px] font-black uppercase tracking-[0.35em] md:tracking-[0.5em] text-emerald-500/80 leading-none">Generative Grammar Arboretum</p>
              </div>
            </div>

            <div className="basis-full md:basis-auto min-w-0 flex-1">
              <div className="flex flex-wrap md:flex-nowrap items-center justify-start md:justify-between gap-2 md:gap-4">
                <div className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-3">
                  {!isTreeBankView ? (
                    <>
                      <button
                        onClick={() => setFramework(framework === 'xbar' ? 'minimalism' : 'xbar')}
                        className={`flex items-center gap-2 md:gap-2.5 min-w-[14rem] justify-center px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest shadow-inner group whitespace-nowrap ${
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

                <div className="flex flex-wrap md:flex-nowrap items-center gap-2 md:gap-4">
                  {!isTreeBankView && (
                    <button
                      onClick={handleSaveCurrentTree}
                      disabled={!analysisBundle || loading || treeBankSaving}
                      className={`flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap ${
                        treeBankSaveSuccess
                          ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                          : 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30 disabled:opacity-30 disabled:cursor-not-allowed'
                      }`}
                      title={analysisBundle ? 'Save current analysis to Tree Bank' : 'Parse a sentence before saving'}
                    >
                      {treeBankSaveSuccess ? <Check size={12} /> : <Archive size={12} />}
                      {treeBankSaving ? 'Saving...' : treeBankSaveSuccess ? 'Saved' : 'Save to Tree Bank'}
                    </button>
                  )}

                  <button
                    onClick={() => setWorkspaceView((current) => (current === 'treeBank' ? 'arboretum' : 'treeBank'))}
                    className={`flex items-center gap-2 px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest whitespace-nowrap ${
                      isTreeBankView
                        ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                        : 'border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30'
                    }`}
                    title={isTreeBankView ? 'Return to Arboretum' : 'Open Tree Bank'}
                  >
                    <Archive size={12} />
                    {isTreeBankView ? 'Back to Arboretum' : `Tree Bank (${treeBankEntries.length})`}
                  </button>

                  {!isTreeBankView && (
                    <div
                      className="flex flex-wrap items-center gap-2"
                      title={
                        analysisBundle?.modelUsed
                          ? `Selected model: ${selectedModelLabel}. Last parse used: ${modelLabel}.`
                          : 'Choose parsing model'
                      }
                    >
                      <label
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border"
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
                            setError(null);
                            setNeedsKey(false);
                          }}
                          className="w-40 bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
                        >
                          {MODEL_OPTIONS.map((model) => (
                            <option key={model.id} value={model.id} className="bg-[#061810]" style={{ color: MODEL_ACCENT_COLORS[model.id] }}>
                              {model.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${REASONING_PILL_STYLES[activeReasoningEffort]}`} title={reasoningControlLabel}>
                        <Brain size={10} className="fill-current" />
                        <select
                          aria-label={reasoningControlLabel}
                          value={activeReasoningEffort}
                          disabled={loading}
                          onChange={(event) => {
                            setReasoningEffort(event.target.value as ReasoningEffort);
                            setError(null);
                          }}
                          className="w-24 bg-transparent text-[11px] font-bold focus:outline-current disabled:opacity-50"
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

      <main data-babel-workspace="true" className="flex-1 relative flex flex-col overflow-hidden">
        {isTreeBankView && (
          <div className="absolute inset-0 z-20 overflow-y-auto px-4 py-6 md:px-12 md:py-12">
            <div className="max-w-7xl mx-auto space-y-8 pb-24">
              <div className="glass-dark rounded-[2.5rem] p-8 md:p-10">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.5em] text-emerald-500/60">Saved Workspace</p>
                    <h2 className="serif text-4xl text-white tracking-tight mt-2">Tree Bank</h2>
                    <p className="text-emerald-50/70 mt-3 max-w-2xl">
                      Re-open any saved sentence with its full generated artifacts, or prune entries you no longer need.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-emerald-400/80">
                    <Archive size={14} />
                    {treeBankEntries.length} {treeBankEntries.length === 1 ? 'Saved Tree' : 'Saved Trees'}
                  </div>
                </div>
                {treeBankError && (
                  <div className="mt-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-300 text-sm">
                    {treeBankError}
                  </div>
                )}
              </div>

              {treeBankLoading ? (
                <div className="glass-dark rounded-[2.5rem] p-12 flex flex-col items-center justify-center gap-4 text-emerald-200/80">
                  <RotateCcw size={22} className="animate-spin" />
                  <p className="text-sm uppercase tracking-[0.25em] font-black">Loading Tree Bank</p>
                </div>
              ) : treeBankEntries.length === 0 ? (
                <div className="glass-dark rounded-[2.5rem] p-14 text-center">
                  <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                    <Archive size={28} />
                  </div>
                  <p className="serif italic text-2xl text-white mb-2">No saved trees yet</p>
                  <p className="text-emerald-50/60 max-w-xl mx-auto">
                    Parse a sentence in the Arboretum, then use "Save to Tree Bank" in the header.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {treeBankEntries.map((entry) => {
                    const safeParseIndex = Math.min(
                      Math.max(entry.activeParseIndex, 0),
                      Math.max((entry.bundle.analyses?.length ?? 1) - 1, 0)
                    );
                    const activeSavedParse = entry.bundle.analyses?.[safeParseIndex];
                    const stageCount = activeSavedParse?.derivationStages?.length ?? 0;

                    return (
                      <div
                        key={entry.id}
                        className="glass-dark rounded-[2.2rem] p-8 border border-white/10 hover:border-emerald-500/40 transition-all"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-[9px] font-black uppercase tracking-[0.35em] text-emerald-400/70">
                              {entry.framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}
                            </p>
                            <p className="mt-3 serif italic text-2xl leading-tight text-white break-words">"{entry.sentence}"</p>
                          </div>
                          <div className="text-[9px] uppercase tracking-[0.2em] font-black text-emerald-500/60 shrink-0 flex items-center gap-2">
                            <Clock3 size={12} />
                            {formatTreeBankDate(entry.updatedAt)}
                          </div>
                        </div>

                        <div className="mt-6 flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-[0.18em]">
                          <span className="px-3 py-1.5 rounded-full border border-emerald-500/25 text-emerald-300/80 bg-emerald-500/10">
                            {(entry.bundle.analyses?.length ?? 0)} {(entry.bundle.analyses?.length ?? 0) === 1 ? 'Parse' : 'Parses'}
                          </span>
                          <span className="px-3 py-1.5 rounded-full border border-white/15 text-white/70 bg-white/5">
                            {stageCount} {stageCount === 1 ? 'Stage' : 'Stages'}
                          </span>
                        </div>

                        <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-[#020806] overflow-hidden h-56">
                          {entry.treeSnapshotDataUrl ? (
                            <img
                              src={entry.treeSnapshotDataUrl}
                              alt={`Tree snapshot for "${entry.sentence}"`}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-emerald-400/50 text-[10px] font-black uppercase tracking-[0.28em]">
                              Tree preview unavailable
                            </div>
                          )}
                        </div>

                        <div className="mt-7 flex items-center gap-3">
                          <button
                            onClick={() => handleOpenTreeBankEntry(entry)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
                          >
                            <FolderOpen size={13} />
                            Open Tree
                          </button>
                          <button
                            onClick={() => setEntryPendingDelete(entry)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-all text-[10px] font-black uppercase tracking-widest"
                          >
                            <Trash2 size={13} />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {!isTreeBankView && hasAmbiguity && (
          <div data-babel-tree-controls="top" className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
            <div className="flex max-w-[min(92vw,64rem)] flex-wrap items-center justify-center gap-2 p-1 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-lg shadow-2xl">
              {(analysisBundle?.analyses || []).map((_, parseIndex) => (
                <button
                  key={`parse-choice-${parseIndex}`}
                  onClick={() => setActiveParseIndex(parseIndex)}
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
              <div className="text-center z-10 min-h-[88px] flex flex-col justify-start">
                <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
                <p className="text-emerald-500/40 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {framework === 'xbar' ? 'X-Bar' : 'Minimalist'} Structures</p>
              </div>
            </div>
          )}

          {!loading && activeParse && (activeTab === 'tree' || activeTab === 'derivation') ? (
            <TreeVisualizer 
              data={activeParse.tree} 
              animated={activeTab === 'derivation'}
              derivationStages={activeParse.derivationStages}
              abstractionMode={abstractionMode}
              sentence={parsedSentence}
            />
          ) : activeParse && activeTab === 'notes' ? (
            <div
              className="w-full h-full flex justify-center overflow-y-auto overflow-x-hidden bg-[#020806]/60 backdrop-blur-md items-start px-4 pt-8 pb-36 md:px-12 md:pt-20 md:pb-44"
            >
              {activeTab === 'notes' && (
                <div className="max-w-4xl w-full space-y-8">
                  <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
                      <div className="flex items-center gap-4 md:gap-5 mb-6 md:mb-8">
                        <div className="w-10 h-10 md:w-12 md:h-12 moss-gradient rounded-2xl flex items-center justify-center text-white shadow-lg">
                          <Info size={24} />
                        </div>
                        <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Derivational Notes</h2>
                      </div>
                      <div className="space-y-5 md:space-y-6">
                        {derivationalNoteParagraphs.map((paragraph, index) => (
                          <p
                            key={`derivational-note-${index}`}
                            className="text-emerald-50/90 leading-relaxed italic serif text-lg md:text-2xl border-l-2 border-emerald-500/20 pl-5 md:pl-8"
                          >
                            &quot;{paragraph}&quot;
                          </p>
                        ))}
                      </div>
                  </div>

                  {(canopyMilesNotation || derivationMilesNotation) && (
                    <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
                       <div className="flex items-center justify-between mb-6 md:mb-8 gap-4">
                          <div className="flex items-center gap-4 md:gap-5">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
                              <Layers size={24} />
                            </div>
                            <div>
                              <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
                              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Canopy + Derivation Miles Shang Formalism</p>
                            </div>
                          </div>
                          <a 
                            href="https://mshang.ca/syntree/" 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 px-6 py-3 rounded-2xl border bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[11px] font-black uppercase tracking-widest"
                          >
                            <ExternalLink size={14} />
                            Miles Shang
                          </a>
                        </div>
                        <div className="space-y-6">
                          {canopyMilesNotation && (
                            <div className="bg-black/40 p-5 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-white/5 shadow-inner">
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Canopy Code</p>
                                <button 
                                  onClick={() => copyMilesCode(canopyMilesNotation, 'canopy')}
                                  className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
                                    copiedCodeKey === 'canopy'
                                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                    : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                                  }`}
                                >
                                  {copiedCodeKey === 'canopy' ? <Check size={13} /> : <Copy size={13} />}
                                  {copiedCodeKey === 'canopy' ? 'Copied to Soil' : 'Copy Canopy'}
                                </button>
                              </div>
                              <code className="text-emerald-400 mono text-sm md:text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                                {canopyMilesNotation}
                              </code>
                            </div>
                          )}

                          {derivationMilesNotation && (
                            <div className="bg-black/40 p-5 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-white/5 shadow-inner">
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Derivation Code (Movement Indexed)</p>
                                <button 
                                  onClick={() => copyMilesCode(derivationMilesNotation, 'derivation')}
                                  className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
                                    copiedCodeKey === 'derivation'
                                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                    : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                                  }`}
                                >
                                  {copiedCodeKey === 'derivation' ? <Check size={13} /> : <Copy size={13} />}
                                  {copiedCodeKey === 'derivation' ? 'Copied to Soil' : 'Copy Derivation'}
                                </button>
                              </div>
                              <code className="text-emerald-400 mono text-sm md:text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                                {derivationMilesNotation}
                              </code>
                            </div>
                          )}
                        </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : !loading && (
            <div className="w-full h-full flex flex-col items-center justify-center text-emerald-900/10 gap-10">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150 animate-pulse"></div>
                <div className="relative z-10 w-24 h-24 md:w-32 md:h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
                  <RootLogo size={104} shape="circle" blend={true} zoom={0.92} className="animate-pulse w-[78px] h-[78px] md:w-[104px] md:h-[104px]" />
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
                  onClick={() => setActiveTab(tab.id)}
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

            {!hideShowcaseInput && !devCaptureMode && (
              <>
                {/* Input UI */}
                <div
                  data-babel-tree-controls="bottom"
                  aria-hidden={!isInputVisible}
                  className={`absolute left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 md:px-8 transition-[opacity,transform] duration-700 ${isInputVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}
                  style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] overflow-hidden">
                    <div className="flex items-center justify-between px-5 md:px-7 py-3 md:py-3.5 border-b border-white/5 bg-black/30">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]"></div>
                        <span className="text-[9px] font-black uppercase tracking-[0.4em] text-emerald-500/80">Arboretum Link</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setIsInputExpanded(!isInputExpanded)}
                          title={isInputExpanded ? "Collapse" : "Expand"}
                          className="p-1.5 hover:bg-white/10 rounded-xl transition-colors text-emerald-500/60"
                        >
                          {isInputExpanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                        </button>
                        <button
                          onClick={() => setIsInputVisible(false)}
                          title="Hide Control Panel"
                          className="p-1.5 hover:bg-rose-500/20 rounded-xl transition-colors text-emerald-500/60 hover:text-rose-400"
                        >
                          <EyeOff size={18} />
                        </button>
                      </div>
                    </div>

                    <div className={`transition-[max-height,opacity,padding] duration-700 ease-in-out ${isInputExpanded ? 'max-h-[350px] opacity-100 p-4 md:p-6 pt-3 md:pt-4' : 'max-h-0 opacity-0'}`}>
                      {error && (
                        <FailurePanel
                          message={error.message}
                          failure={error.failure}
                          rawOutput={error.rawOutput}
                          generationRecord={error.generationRecord}
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
                            className="w-full bg-black/40 border border-white/10 rounded-2xl p-3 md:p-4 text-emerald-50 serif italic placeholder:text-emerald-900/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all resize-none h-16 md:h-20 text-base md:text-lg shadow-inner leading-relaxed"
                            placeholder={`Plant a ${framework === 'xbar' ? 'Generative' : 'Minimalist'} linguistic seed...`}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleParse();
                              }
                            }}
                            disabled={loading}
                          />
                        </div>
                        <button
                          type="submit"
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
                      <div className="px-5 md:px-7 py-3 md:py-4 flex items-center justify-between cursor-pointer group hover:bg-white/5 transition-colors" onClick={() => setIsInputExpanded(true)}>
                        <span className="text-emerald-50/50 serif italic text-xs md:text-sm truncate max-w-[220px] md:max-w-[400px]">"{input}"</span>
                        <span className="text-[8px] font-black text-emerald-500/30 uppercase tracking-[0.4em] group-hover:text-emerald-500 transition-colors">Expand Arbor Control</span>
                      </div>
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
                  >
                    <RootLogo size={34} shape="circle" blend={true} zoom={0.92} className="animate-pulse w-7 h-7 md:w-[34px] md:h-[34px]" />
                  </button>
                )}
              </>
            )}
          </>
        )}

        {entryPendingDelete && (
          <div className="absolute inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center px-6">
            <div className="glass-dark rounded-[2rem] p-8 w-full max-w-xl border border-emerald-500/40 shadow-[0_0_30px_rgba(16,185,129,0.14)]">
              <h3 className="serif text-3xl text-white mt-1 mb-4">Delete saved tree?</h3>
              <p className="text-emerald-50/80 leading-relaxed">
                This will permanently remove <span className="italic">"{entryPendingDelete.sentence}"</span> from Tree Bank.
              </p>
              <div className="mt-7 flex items-center gap-3">
                <button
                  onClick={handleDeleteTreeBankEntry}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                  <Trash2 size={13} />
                  Delete Tree
                </button>
                <button
                  onClick={() => setEntryPendingDelete(null)}
                  className="px-5 py-2.5 rounded-xl border border-white/15 bg-white/5 text-white/70 hover:text-emerald-300 hover:border-emerald-500/40 transition-all text-[10px] font-black uppercase tracking-widest"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
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
