import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseSentence } from './services/geminiService';
import { MovementEvent, ParseBundle, ParseResult, SyntaxNode } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import { 
  BookOpen, 
  RotateCcw, 
  Sparkles,
  TreeDeciduous,
  Sprout,
  AlertTriangle,
  Layers,
  Zap,
  Info,
  Leaf,
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

type AppTab = 'tree' | 'growth' | 'pos' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'growth', icon: FlameKindling, label: 'Growth Simulation' },
  { id: 'pos', icon: BookOpen, label: 'Catalog' },
  { id: 'notes', icon: FileText, label: 'Notes' },
];

const KEY_ERROR_CODES = new Set(['API_KEY_EXPIRED', 'API_KEY_MISSING', 'API_KEY_INVALID']);

const resolveUiError = (err: unknown): { needsKey: boolean; message: string } => {
  const message = err instanceof Error ? err.message : String(err || '');
  if (KEY_ERROR_CODES.has(message)) {
    return {
      needsKey: true,
      message: 'Your API key is missing or invalid. Please update it below.'
    };
  }

  return {
    needsKey: false,
    message: message || 'Linguistic growth interrupted.'
  };
};

const formatModelLabel = (modelUsed?: string): string => {
  const model = String(modelUsed || '').trim();
  if (!model) return 'Gemini 3.1 Pro';
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

type MilesMode = 'canopy' | 'growth';
type CopyCodeKey = 'canopy' | 'growth';
type WorkspaceView = 'arboretum' | 'treeBank';

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

  const svg = document.querySelector('.tree-canvas-bg svg') as SVGSVGElement | null;
  if (!svg) return undefined;

  const SNAPSHOT_WIDTH = 1600;
  const SNAPSHOT_HEIGHT = 980;
  const SNAPSHOT_PADDING = 72;

  const clone = svg.cloneNode(true) as SVGSVGElement;
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
      const bbox = liveGroup.getBBox();
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
  const bundle = candidate.bundle as ParseBundle | undefined;
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

interface MovementIndexMaps {
  movedByNodeId: Map<string, string>;
  traceByNodeId: Map<string, string>;
}

const EMPTY_MOVEMENT_INDEX_MAPS: MovementIndexMaps = {
  movedByNodeId: new Map(),
  traceByNodeId: new Map()
};

const NULL_SURFACE_RE = /^(∅|Ø|ε|null|epsilon)$/i;
const TRACE_SURFACE_RE = /^(t(?:race)?(?:[_-]?[a-z0-9]+)?|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;
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

const indexToLetter = (index: number): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  if (index < alphabet.length) return alphabet[index];
  const base = alphabet[index % alphabet.length];
  const cycle = Math.floor(index / alphabet.length);
  return `${base}${cycle}`;
};

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

const appendMovementIndex = (token: string, movementIndex?: string): string => {
  const base = String(token || '').trim();
  if (!base || !movementIndex) return base;
  if (/_([a-z0-9]+)$/i.test(base)) return base;
  return `${base}_${movementIndex}`;
};

const collectLeafNodes = (root: SyntaxNode): SyntaxNode[] => {
  const leaves: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      leaves.push(node);
      return;
    }
    children.forEach(visit);
  };
  visit(root);
  return leaves;
};

const resolveLeafSurface = (node: SyntaxNode): string =>
  String(node.word || node.label || '').trim();

const pickLexicalAnchor = (node: SyntaxNode): SyntaxNode | null => {
  const leaves = collectLeafNodes(node);
  if (leaves.length === 0) return null;

  return (
    leaves.find((leaf) => {
      const surface = resolveLeafSurface(leaf);
      return surface.length > 0 && !NULL_SURFACE_RE.test(surface) && !TRACE_SURFACE_RE.test(surface);
    }) ||
    leaves.find((leaf) => {
      const surface = resolveLeafSurface(leaf);
      return surface.length > 0 && !NULL_SURFACE_RE.test(surface);
    }) ||
    leaves[0]
  );
};

const pickTraceAnchor = (node: SyntaxNode): SyntaxNode | null => {
  const leaves = collectLeafNodes(node);
  if (leaves.length === 0) return null;

  return (
    leaves.find((leaf) => TRACE_SURFACE_RE.test(resolveLeafSurface(leaf))) ||
    leaves.find((leaf) => NULL_SURFACE_RE.test(resolveLeafSurface(leaf))) ||
    leaves[0]
  );
};

const buildNodeIndex = (root: SyntaxNode): Map<string, SyntaxNode> => {
  const byId = new Map<string, SyntaxNode>();
  const visit = (node: SyntaxNode) => {
    const id = String(node.id || '').trim();
    if (id) byId.set(id, node);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(root);
  return byId;
};

const buildMovementIndexMaps = (
  tree: SyntaxNode,
  movementEvents?: MovementEvent[]
): MovementIndexMaps => {
  if (!movementEvents || movementEvents.length === 0) return EMPTY_MOVEMENT_INDEX_MAPS;

  const nodeById = buildNodeIndex(tree);
  const movedByNodeId = new Map<string, string>();
  const traceByNodeId = new Map<string, string>();
  const seenPairs = new Set<string>();
  let nextIndex = 0;

  movementEvents.forEach((event) => {
    const toNode = nodeById.get(String(event.toNodeId || '').trim());
    const fromNode = nodeById.get(String(event.fromNodeId || '').trim());
    if (!toNode || !fromNode) return;

    const traceNode = event.traceNodeId ? nodeById.get(String(event.traceNodeId).trim()) : undefined;
    const movedAnchor = pickLexicalAnchor(toNode) || pickLexicalAnchor(fromNode);
    const traceAnchor = traceNode ? pickTraceAnchor(traceNode) : pickTraceAnchor(fromNode);
    if (!movedAnchor?.id) return;

    const pairKey = `${traceAnchor?.id || event.fromNodeId}->${movedAnchor.id}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);

    const movementIndex = indexToLetter(nextIndex);
    nextIndex += 1;

    movedByNodeId.set(movedAnchor.id, movementIndex);
    if (traceAnchor?.id) {
      traceByNodeId.set(traceAnchor.id, movementIndex);
    }
  });

  return { movedByNodeId, traceByNodeId };
};

const applyGrowthMovementNotation = (
  node: SyntaxNode,
  surface: string,
  movementMaps: MovementIndexMaps
): string => {
  const nodeId = String(node.id || '').trim();
  if (!nodeId || !surface) return surface;

  const movedIndex = movementMaps.movedByNodeId.get(nodeId);
  if (movedIndex) {
    return appendMovementIndex(surface, movedIndex);
  }

  const traceIndex = movementMaps.traceByNodeId.get(nodeId);
  if (traceIndex) {
    if (/^<[^>]+>$/.test(surface) || /^⟨[^⟩]+⟩$/.test(surface)) return surface;
    return `<${traceIndex}>`;
  }

  return surface;
};

const serializeMilesNode = (
  node: SyntaxNode,
  mode: MilesMode,
  movementMaps: MovementIndexMaps
): string => {
  const label = String(node.label || '').trim();
  const word = String(node.word || '').trim();
  const children = Array.isArray(node.children) ? node.children : [];

  if (children.length === 0) {
    const rawSurface = (word || label || '∅').trim();
    const nodeId = String(node.id || '').trim();
    const movedIndex = mode === 'growth' && nodeId
      ? movementMaps.movedByNodeId.get(nodeId)
      : undefined;
    const attachMovementToLabel = Boolean(
      mode === 'growth' &&
      movedIndex &&
      word &&
      label &&
      label !== word &&
      isLikelySyntacticCategory(label)
    );
    const surfaced = mode === 'growth'
      ? (attachMovementToLabel ? rawSurface : applyGrowthMovementNotation(node, rawSurface, movementMaps))
      : rawSurface;
    const token = sanitizeMilesToken(surfaced || '∅');

    if (word) {
      if (label && label !== word && isLikelySyntacticCategory(label)) {
        const categoryToken = attachMovementToLabel
          ? sanitizeMilesToken(appendMovementIndex(label, movedIndex))
          : sanitizeMilesToken(label);
        return `[${categoryToken} ${token}]`;
      }
      return token;
    }

    if (label && isLikelySyntacticCategory(label)) {
      return `[${sanitizeMilesToken(label)} ${token === sanitizeMilesToken(label) ? '∅' : token}]`;
    }

    return token;
  }

  const serializedChildren = children
    .map((child) => serializeMilesNode(child, mode, movementMaps))
    .filter((value) => value.length > 0);

  const nodeLabel = sanitizeMilesToken(label || word || 'X');
  if (serializedChildren.length === 0) return `[${nodeLabel}]`;
  return `[${nodeLabel} ${serializedChildren.join(' ')}]`;
};

const buildMilesNotation = (
  tree: SyntaxNode,
  mode: MilesMode,
  movementEvents?: MovementEvent[]
): string => {
  const movementMaps = mode === 'growth'
    ? buildMovementIndexMaps(tree, movementEvents)
    : EMPTY_MOVEMENT_INDEX_MAPS;
  return serializeMilesNode(tree, mode, movementMaps).trim();
};

const App: React.FC = () => {
  const appContainerRef = useRef<HTMLDivElement>(null);
  const treeBankSaveSuccessTimeoutRef = useRef<number | null>(null);
  const copiedCodeTimeoutRef = useRef<number | null>(null);
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
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>('tree');
  const [isInputExpanded, setIsInputExpanded] = useState(true);
  const [isInputVisible, setIsInputVisible] = useState(true);
  const [needsKey, setNeedsKey] = useState(false);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
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
  const hasAmbiguity = (analysisBundle?.analyses?.length ?? 0) === 2;
  const modelLabel = formatModelLabel(analysisBundle?.modelUsed);
  const isFallbackModel = Boolean(analysisBundle?.fallbackUsed);
  const isTreeBankView = workspaceView === 'treeBank';
  const canopyMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    const modelProvided = String(activeParse.bracketedNotation || '').trim();
    if (modelProvided) return modelProvided;
    return buildMilesNotation(activeParse.tree, 'canopy', activeParse.movementEvents);
  }, [activeParse]);
  const growthMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'growth', activeParse.movementEvents);
  }, [activeParse]);

  useEffect(() => {
    const checkKeyStatus = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) setNeedsKey(true);
      }
    };
    checkKeyStatus();
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
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

  const handleOpenKeySelection = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      try {
        await aistudio.openSelectKey();
        setNeedsKey(false);
        setError(null);
        if (loading) handleParse();
      } catch (err) {
        console.error("Key selection failed", err);
      }
    }
  };

  const handleParse = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
    if (!input.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await parseSentence(input, framework);
      setAnalysisBundle(data);
      setParsedSentence(input.trim());
      setActiveParseIndex(0);
      setActiveTab('tree');
      setCopiedCodeKey(null);
      setNeedsKey(false);
    } catch (err: unknown) {
      const uiError = resolveUiError(err);
      setNeedsKey(uiError.needsKey);
      setError(uiError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCurrentTree = async () => {
    if (!analysisBundle || treeBankSaving || loading) return;

    const sentence = parsedSentence.trim() || input.trim();
    if (!sentence) return;

    const now = new Date().toISOString();
    const snapshot = JSON.parse(JSON.stringify(analysisBundle)) as ParseBundle;
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
    const appContainer = appContainerRef.current;
    if (!appContainer) return;

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await appContainer.requestFullscreen();
      }
    } catch (err) {
      console.error('Fullscreen toggle failed', err);
    }
  };

  return (
    <div ref={appContainerRef} className="app-shell h-screen flex flex-col overflow-hidden selection:bg-emerald-500 selection:text-white">
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
      <header className="bg-black/60 backdrop-blur-xl border-b border-white/10 z-40 px-8 py-4 shrink-0 shadow-2xl">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 moss-gradient rounded-xl flex items-center justify-center text-white shadow-[0_0_20px_rgba(6,78,59,0.5)] rotate-3">
                <Sprout size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tighter text-white serif leading-tight">Sylvan Architect Babel</h1>
                <p className="text-[7px] font-black uppercase tracking-[0.5em] text-emerald-500/80 leading-none">Generative Grammar Arboretum</p>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden md:block"></div>

            {!isTreeBankView ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setFramework(framework === 'xbar' ? 'minimalism' : 'xbar')}
                  className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest shadow-inner group ${
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
                    {framework === 'xbar' ? 'X̄' : 'vP'}
                  </span>
                  {framework === 'xbar' ? 'X-Bar Theory' : 'Minimalist Program'}
                </button>

                <button
                  onClick={() => setAbstractionMode(!abstractionMode)}
                  className={`flex items-center gap-2.5 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest shadow-inner group ${
                    abstractionMode
                    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                    : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                  }`}
                >
                  <Triangle size={12} className={`${abstractionMode ? 'fill-amber-400' : 'group-hover:text-emerald-400'} transition-colors`} />
                  Constituent Glyphing
                </button>
              </div>
            ) : (
              <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl border border-emerald-500/20 bg-emerald-950/20 text-emerald-300/90 text-[9px] font-black uppercase tracking-widest">
                <Archive size={12} />
                Tree Bank Library
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {!isTreeBankView && (
              <button
                onClick={handleSaveCurrentTree}
                disabled={!analysisBundle || loading || treeBankSaving}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest ${
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
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-widest ${
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
                className={`hidden md:flex items-center gap-2 text-[9px] font-black px-5 py-2.5 rounded-full border tracking-widest uppercase shadow-inner ${
                  isFallbackModel
                    ? 'text-amber-300 bg-amber-950/30 border-amber-800/40'
                    : 'text-emerald-400 bg-emerald-950/40 border-emerald-900/30'
                }`}
                title={analysisBundle?.modelUsed ? `Model route: ${analysisBundle.modelUsed}` : 'Model route'}
              >
                <Zap size={10} className={isFallbackModel ? 'fill-amber-300' : 'fill-emerald-400'} />
                {isFallbackModel ? `Fallback · ${modelLabel}` : modelLabel}
              </div>
            )}
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-emerald-400 hover:border-emerald-500/30 transition-all text-[9px] font-black uppercase tracking-widest"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 relative flex flex-col overflow-hidden">
        {isTreeBankView && (
          <div className="absolute inset-0 z-20 overflow-y-auto px-8 py-10 md:px-12 md:py-12">
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
                    const movementCount = activeSavedParse?.movementEvents?.length ?? 0;
                    const derivationCount = activeSavedParse?.derivationSteps?.length ?? 0;

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
                            {derivationCount} Derivation Steps
                          </span>
                          <span className="px-3 py-1.5 rounded-full border border-white/15 text-white/70 bg-white/5">
                            {movementCount} Movements
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
          <div className="absolute top-6 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 p-1 rounded-2xl border border-white/10 bg-black/50 backdrop-blur-lg shadow-2xl">
              <button
                onClick={() => setActiveParseIndex(0)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  activeParseIndex === 0
                    ? 'moss-gradient text-white border border-emerald-400/50'
                    : 'text-white/60 hover:text-emerald-300'
                }`}
              >
                Parse 1
              </button>
              <button
                onClick={() => setActiveParseIndex(1)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  activeParseIndex === 1
                    ? 'moss-gradient text-white border border-emerald-400/50'
                    : 'text-white/60 hover:text-emerald-300'
                }`}
              >
                Parse 2
              </button>
            </div>
          </div>
        )}

        {!isTreeBankView && (
        <div className="absolute inset-0 z-0">
          {loading && (
            <div className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center gap-8 animate-in fade-in duration-700">
              <div className="relative">
                <div className="w-28 h-28 border-[6px] border-emerald-950/50 border-t-emerald-500 rounded-full animate-spin shadow-[0_0_100px_rgba(16,185,129,0.2)]"></div>
                <Leaf className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-500 animate-pulse" size={38} />
              </div>
              <div className="text-center">
                <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
                <p className="text-emerald-500/40 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {framework === 'xbar' ? 'X-Bar' : 'Minimalist'} Structures</p>
              </div>
            </div>
          )}

          {!loading && activeParse && (activeTab === 'tree' || activeTab === 'growth') ? (
            <TreeVisualizer 
              data={activeParse.tree} 
              animated={activeTab === 'growth'} 
              derivationSteps={activeParse.derivationSteps}
              movementEvents={activeParse.movementEvents}
              abstractionMode={abstractionMode}
              sentence={parsedSentence}
            />
          ) : activeParse && (activeTab === 'pos' || activeTab === 'notes') ? (
            <div
              className={`w-full h-full flex justify-center overflow-y-auto overflow-x-hidden bg-[#020806]/60 backdrop-blur-md ${
                activeTab === 'notes'
                  ? 'items-start px-12 pt-20 pb-44'
                  : 'items-center p-12'
              }`}
            >
              {activeTab === 'pos' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl w-full">
                  {(activeParse.partsOfSpeech ?? []).map((item, idx) => (
                    <div key={idx} className="p-8 bg-black/60 border border-white/5 rounded-[2.5rem] flex flex-col items-center justify-center gap-3 hover:border-emerald-500/40 transition-all shadow-2xl group hover:-translate-y-1">
                      <span className="text-[9px] font-black text-emerald-500/40 uppercase tracking-[0.5em]">{item.pos}</span>
                      <span className="font-bold text-white serif italic text-2xl tracking-tight">{item.word}</span>
                    </div>
                  ))}
                </div>
              )}
              {activeTab === 'notes' && (
                <div className="max-w-4xl w-full space-y-8">
                  <div className="glass-dark p-12 rounded-[3rem] shadow-2xl">
                     <div className="flex items-center gap-5 mb-8">
                        <div className="w-12 h-12 moss-gradient rounded-2xl flex items-center justify-center text-white shadow-lg">
                          <Info size={24} />
                        </div>
                        <h2 className="text-3xl font-bold text-white serif tracking-tight">Structural Geneology ({framework === 'xbar' ? 'X-Bar' : 'Minimalism'})</h2>
                      </div>
                      {activeParse.interpretation && (
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400/70 mb-4">{activeParse.interpretation}</p>
                      )}
                      <p className="text-emerald-50/90 leading-relaxed italic serif text-2xl border-l-2 border-emerald-500/20 pl-8">"{activeParse.explanation}"</p>
                  </div>

                  {(canopyMilesNotation || growthMilesNotation) && (
                    <div className="glass-dark p-12 rounded-[3rem] shadow-2xl">
                       <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-5">
                            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
                              <Layers size={24} />
                            </div>
                            <div>
                              <h2 className="text-3xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
                              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Canopy + Growth Miles Shang Formalism</p>
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
                            <div className="bg-black/40 p-8 rounded-[2rem] border border-white/5 shadow-inner">
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
                              <code className="text-emerald-400 mono text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                                {canopyMilesNotation}
                              </code>
                            </div>
                          )}

                          {growthMilesNotation && (
                            <div className="bg-black/40 p-8 rounded-[2rem] border border-white/5 shadow-inner">
                              <div className="flex items-center justify-between mb-4">
                                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Growth Code (Movement Indexed)</p>
                                <button 
                                  onClick={() => copyMilesCode(growthMilesNotation, 'growth')}
                                  className={`flex items-center gap-3 px-5 py-2.5 rounded-2xl border transition-all text-[10px] font-black uppercase tracking-widest ${
                                    copiedCodeKey === 'growth'
                                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                                    : 'bg-white/5 border-white/10 text-white/40 hover:text-emerald-400 hover:border-emerald-500/30'
                                  }`}
                                >
                                  {copiedCodeKey === 'growth' ? <Check size={13} /> : <Copy size={13} />}
                                  {copiedCodeKey === 'growth' ? 'Copied to Soil' : 'Copy Growth'}
                                </button>
                              </div>
                              <code className="text-emerald-400 mono text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
                                {growthMilesNotation}
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
                <div className="relative z-10 w-32 h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
                  <Sprout size={64} className="text-emerald-500/40 animate-pulse" />
                </div>
              </div>
              <div className="text-center z-10">
                <p className="font-extrabold text-white text-3xl mono mb-3 tracking-tighter">Awaiting Structural Genesis</p>
                <p className="text-emerald-900 font-black uppercase text-[10px] tracking-[0.8em] opacity-80 text-balance max-w-lg mx-auto">Cast a thought into the generative soil to begin its derivation.</p>
              </div>
            </div>
          )}
        </div>
        )}

        {!isTreeBankView && (
          <>
            {/* Navigation Sidebar */}
            <div className="absolute right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-4">
              {NAV_TABS.map((tab) => (
                <button
                  key={tab.id}
                  disabled={!activeParse}
                  onClick={() => setActiveTab(tab.id)}
                  className={`group relative w-14 h-14 rounded-2xl flex items-center justify-center transition-all border shadow-2xl disabled:opacity-20 disabled:cursor-not-allowed ${
                    activeTab === tab.id
                    ? 'moss-gradient text-white border-emerald-400/50 shadow-[0_0_20px_rgba(6,78,59,0.4)] scale-110'
                    : 'glass-dark text-emerald-600/60 border-white/5 hover:text-emerald-400 hover:border-white/10 hover:scale-105'
                  }`}
                >
                  <tab.icon size={22} />
                  <span className="absolute right-full mr-5 px-4 py-2 rounded-xl bg-black/90 backdrop-blur-xl text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400 opacity-0 group-hover:opacity-100 pointer-events-none transition-all border border-white/10 whitespace-nowrap shadow-2xl translate-x-2 group-hover:translate-x-0">
                    {tab.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Input UI */}
            <div className={`absolute bottom-10 left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-8 transition-all duration-700 ${isInputVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}>
              <div className={`glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] transition-all duration-700 overflow-hidden`}>
                <div className="flex items-center justify-between px-7 py-3.5 border-b border-white/5 bg-black/30">
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

                <div className={`transition-all duration-700 ease-in-out ${isInputExpanded ? 'max-h-[350px] opacity-100 p-6 pt-4' : 'max-h-0 opacity-0'}`}>
                  {error && (
                    <div className="mb-4 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-2xl flex flex-col gap-3 text-rose-400 text-xs shadow-inner">
                      <div className="flex items-center gap-3 italic serif">
                        <AlertTriangle size={14} className="shrink-0" /> {error}
                      </div>
                      {needsKey && (
                        <button
                          onClick={handleOpenKeySelection}
                          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/40 transition-all font-black uppercase tracking-widest text-[10px] text-rose-200 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                        >
                          <Key size={12} />
                          Renew API Credentials
                        </button>
                      )}
                    </div>
                  )}

                  <form onSubmit={handleParse} className="flex gap-4 items-end">
                    <div className="flex-1 relative">
                      <textarea
                        className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 text-emerald-50 serif italic placeholder:text-emerald-900/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/10 transition-all resize-none h-20 text-lg shadow-inner leading-relaxed"
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
                      className="moss-gradient hover:brightness-110 disabled:opacity-40 text-white font-black w-20 h-20 rounded-2xl flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.4)] active:scale-90 transition-all group shrink-0"
                    >
                      {loading ? (
                        <RotateCcw className="animate-spin" size={24} />
                      ) : (
                        <Sparkles size={24} className="group-hover:rotate-12 group-hover:scale-110 transition-transform" />
                      )}
                    </button>
                  </form>
                </div>
                {!isInputExpanded && (
                   <div className="px-7 py-4 flex items-center justify-between cursor-pointer group hover:bg-white/5 transition-colors" onClick={() => setIsInputExpanded(true)}>
                      <span className="text-emerald-50/50 serif italic text-sm truncate max-w-[400px]">"{input}"</span>
                      <span className="text-[8px] font-black text-emerald-500/30 uppercase tracking-[0.4em] group-hover:text-emerald-500 transition-colors">Expand Arbor Control</span>
                   </div>
                )}
              </div>
            </div>

            {/* Restore Sprout Trigger */}
            {!isInputVisible && (
              <button
                onClick={() => setIsInputVisible(true)}
                className="absolute bottom-10 left-1/2 -translate-x-1/2 z-50 w-14 h-14 moss-gradient rounded-full flex items-center justify-center text-white shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:scale-110 active:scale-95 transition-all animate-in fade-in slide-in-from-bottom-4 duration-500"
                title="Restore Arboretum Link"
              >
                <Sprout size={28} className="animate-pulse" />
              </button>
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
      <footer className="bg-black/80 border-t border-white/10 py-4 px-10 shrink-0 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between text-[8px] font-black text-emerald-900/50 uppercase tracking-[0.5em]">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-3"><Layers size={12} /> Sylvan Logic Engine</span>
            <span className="h-3 w-px bg-white/10"></span>
            <span className="flex items-center gap-3"><TreeDeciduous size={12} /> Deep Structural Formalism</span>
          </div>
          <div className="flex items-center gap-6">
            {needsKey && (
              <button 
                onClick={handleOpenKeySelection}
                className="flex items-center gap-2 text-rose-500/80 hover:text-rose-400 transition-colors"
              >
                <Key size={10} /> Key Missing/Invalid - Update
              </button>
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
