import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseSentence } from './services/geminiService';
import { DerivationStep, MovementEvent, ParseBundle, ParseResult, ReplayLedgerBlock, SyntaxNode } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import RootLogo from './components/RootLogo';
import {
  buildMovementIndexMaps,
  resolveMovementEventLinks,
  MovementIndexMaps,
  EMPTY_MOVEMENT_INDEX_MAPS
} from './movementEvents';
import {
  stringifyLedgerAtom,
  hasMeaningfulLedgerText,
  normalizeLedgerDisplay,
  humanizeLedgerFallbackId,
  humanizeLedgerStructuralHead,
  formatAgreementReplayEntry,
  formatSelectionReplayEntry,
  formatCaseAssignmentReplayEntry,
  formatThetaAssignmentReplayEntry,
  formatBindingReplayEntry,
  formatClausalDependencyReplayEntry,
  formatPredicateClassReplayEntry,
  formatProbeReplayEntry,
  formatNullElementReplayEntry,
  formatDiagnosticReplayEntry,
  formatParameterReplayEntry,
  formatInformationStructureReplayEntry,
  formatOperatorScopeReplayEntry,
  formatVoiceValencyReplayEntry,
  formatLinearizationReplayEntry,
  formatLocalityReplayEntry,
  formatPredicationReplayEntry
} from './replayLedgerDisplay';
import { 
  RotateCcw, 
  Sparkles,
  TreeDeciduous,
  AlertTriangle,
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

type AppTab = 'tree' | 'growth' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'growth', icon: FlameKindling, label: 'Growth Simulation' },
  { id: 'notes', icon: FileText, label: 'Notes' },
];

const KEY_ERROR_CODES = new Set(['API_KEY_EXPIRED', 'API_KEY_MISSING', 'API_KEY_INVALID']);

type KeyPromptMode = 'none' | 'gemini' | 'external';

const resolveUiError = (err: unknown): { needsKey: boolean; keyPromptMode: KeyPromptMode; message: string } => {
  const message = err instanceof Error ? err.message : String(err || '');
  if (KEY_ERROR_CODES.has(message)) {
    return {
      needsKey: true,
      keyPromptMode: 'gemini',
      message: 'Your API key is missing or invalid. Please update it below.'
    };
  }

  return {
    needsKey: false,
    keyPromptMode: 'none',
    message: message || 'Linguistic growth interrupted.'
  };
};

const formatModelLabel = (modelUsed?: string): string => {
  const model = String(modelUsed || '').trim();
  if (!model) return 'Local Model';
  if (/^local:/i.test(model)) {
    const detail = model.replace(/^local:/i, '').trim();
    return detail ? `Local Model (${detail})` : 'Local Model';
  }
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

type ModelMode = 'local' | 'pro' | 'gpt-5.4' | 'claude-4.6';

const MODEL_ROUTE_LABELS: Record<ModelMode, string> = {
  local: 'Local Model',
  pro: 'Gemini 3.1 Pro',
  'gpt-5.4': 'GPT 5.4',
  'claude-4.6': 'Claude 4.6'
};

const MODEL_MODE_PILLS: Array<{
  id: ModelMode;
  label: string;
  className: string;
  activeClassName: string;
  keyRequired?: boolean;
}> = [
  {
    id: 'local',
    label: 'Local',
    className: 'border-sky-900/40 bg-sky-950/20 text-sky-200 hover:border-sky-600/50 hover:bg-sky-900/30',
    activeClassName: 'border-sky-500/70 bg-sky-500/20 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.22)]'
  },
  {
    id: 'pro',
    label: 'Gemini Pro',
    className: 'border-purple-900/40 bg-purple-950/20 text-purple-200 hover:border-purple-600/50 hover:bg-purple-900/30',
    activeClassName: 'border-purple-500/70 bg-purple-500/20 text-purple-100 shadow-[0_0_18px_rgba(168,85,247,0.22)]'
  },
  {
    id: 'gpt-5.4',
    label: 'GPT 5.4',
    className: 'border-blue-900/40 bg-blue-950/20 text-blue-200 hover:border-blue-600/50 hover:bg-blue-900/30',
    activeClassName: 'border-blue-500/70 bg-blue-500/20 text-blue-100 shadow-[0_0_18px_rgba(59,130,246,0.24)]',
    keyRequired: true
  },
  {
    id: 'claude-4.6',
    label: 'Claude 4.6',
    className: 'border-orange-900/40 bg-orange-950/20 text-orange-200 hover:border-orange-600/50 hover:bg-orange-900/30',
    activeClassName: 'border-orange-500/70 bg-orange-500/20 text-orange-100 shadow-[0_0_18px_rgba(249,115,22,0.24)]',
    keyRequired: true
  }
];

const isBackendModelMode = (value: ModelMode): value is 'local' | 'pro' =>
  value === 'local' || value === 'pro';

const isExternalApiModelMode = (value: ModelMode): value is 'gpt-5.4' | 'claude-4.6' =>
  value === 'gpt-5.4' || value === 'claude-4.6';

const coerceModelRoute = (value?: string): ModelMode => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'pro') return 'pro';
  if (normalized === 'gpt-5.4') return 'gpt-5.4';
  if (normalized === 'claude-4.6') return 'claude-4.6';
  return 'local';
};

const inferModelRouteFromModel = (modelUsed?: string): ModelMode => {
  const model = String(modelUsed || '').trim().toLowerCase();
  if (!model) return 'local';
  if (model.startsWith('local:') || model.includes('ollama') || model.includes('gemma')) return 'local';
  if (model.includes('claude')) return 'claude-4.6';
  if (model.includes('gpt-5.4') || model.includes('gpt-5')) return 'gpt-5.4';
  return 'pro';
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

const NULL_SURFACE_RE = /^(∅|Ø|ε|null|epsilon)$/i;
const TRACE_SURFACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9{}]+|trace[_-][a-z0-9{}]+|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\})$/i;
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

const appendMovementIndex = (token: string, movementIndex?: string): string => {
  const base = String(token || '').trim();
  if (!base || !movementIndex) return base;
  if (/_([a-z0-9]+)$/i.test(base)) return base;
  return `${base}_${movementIndex}`;
};

const resolveLeafSurface = (node: SyntaxNode): string =>
  String(node.word || node.label || '').trim();

const TRACE_SUBSCRIPT_TO_ASCII: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't'
};

const normalizeTraceSymbol = (value?: string): string =>
  [...String(value || '').trim()].map((ch) => TRACE_SUBSCRIPT_TO_ASCII[ch] || ch).join('');

const extractRawTraceMovementIndex = (value?: string): string | null => {
  const normalized = normalizeTraceSymbol(value);
  if (!normalized || !/^(?:t|trace)/i.test(normalized)) return null;
  const suffix = normalized.replace(/^(?:t|trace)/i, '').replace(/^[_-]/, '').trim();
  return suffix || null;
};

const collectLeafSyntaxNodes = (node: SyntaxNode, out: SyntaxNode[] = []): SyntaxNode[] => {
  if (!node || typeof node !== 'object') return out;
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
    : [];
  if (children.length === 0) {
    out.push(node);
    return out;
  }
  children.forEach((child) => collectLeafSyntaxNodes(child, out));
  return out;
};

const collectForestLeafSyntaxNodes = (forest?: SyntaxNode[] | null): SyntaxNode[] =>
  (Array.isArray(forest) ? forest : []).flatMap((node) => collectLeafSyntaxNodes(node));

const findNodeById = (node: SyntaxNode | null | undefined, targetId: string): SyntaxNode | null => {
  if (!node || typeof node !== 'object') return null;
  const normalizedTargetId = String(targetId || '').trim();
  if (!normalizedTargetId) return null;
  if (String(node.id || '').trim() === normalizedTargetId) return node;
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
    : [];
  for (const child of children) {
    const found = findNodeById(child, normalizedTargetId);
    if (found) return found;
  }
  return null;
};

const buildGrowthFirstMovementMaps = (
  parse: ParseResult,
  baseMaps: MovementIndexMaps
): MovementIndexMaps => {
  const frames = Array.isArray(parse.growthFrames) ? parse.growthFrames : [];

  const movedByNodeId = new Map(baseMaps.movedByNodeId);
  const traceByNodeId = new Map(baseMaps.traceByNodeId);
  const chainIndexById = new Map<string, string>();
  let nextIndex = 1;

  const registerChain = (candidate?: string): string => {
    const key = String(candidate || '').trim();
    if (!key) return '';
    const existing = chainIndexById.get(key);
    if (existing) return existing;
    const assigned = String(nextIndex);
    nextIndex += 1;
    chainIndexById.set(key, assigned);
    return assigned;
  };

  (Array.isArray(parse.movementEvents) ? parse.movementEvents : []).forEach((event) => {
    registerChain(event.chainId);
  });
  (Array.isArray(parse.chains) ? parse.chains : []).forEach((chain) => {
    registerChain(chain?.chainId);
  });
  frames.forEach((frame) => {
    registerChain(frame?.chainId);
  });

  const assignIndexToNodeAndLeaves = (
    nodeId: string,
    index: string,
    destination: Map<string, string>
  ) => {
    const normalizedNodeId = String(nodeId || '').trim();
    const normalizedIndex = String(index || '').trim();
    if (!normalizedNodeId || !normalizedIndex) return;
    destination.set(normalizedNodeId, normalizedIndex);
    const node = findNodeById(parse.tree, normalizedNodeId);
    if (!node) return;
    collectLeafSyntaxNodes(node)
      .map((leaf) => String(leaf.id || '').trim())
      .filter(Boolean)
      .forEach((leafId) => destination.set(leafId, normalizedIndex));
  };

  // Some live bundles omit movement events for a chain even though the final
  // ledger already names the pronounced and silent copies. Use that ledger to
  // decorate traces in growth mode without inventing a new replay step.
  (Array.isArray(parse.chains) ? parse.chains : []).forEach((chain) => {
    const canonicalIndex = registerChain(chain?.chainId);
    if (!canonicalIndex) return;
    const pronouncedCopy = String(chain?.pronouncedCopy || '').trim();
    if (pronouncedCopy && !movedByNodeId.has(pronouncedCopy)) {
      assignIndexToNodeAndLeaves(pronouncedCopy, canonicalIndex, movedByNodeId);
    }
    const silentCopies = Array.isArray(chain?.silentCopies) ? chain.silentCopies : [];
    silentCopies.forEach((silentCopyId) => {
      const normalizedSilentCopyId = String(silentCopyId || '').trim();
      if (!normalizedSilentCopyId || traceByNodeId.has(normalizedSilentCopyId)) return;
      assignIndexToNodeAndLeaves(normalizedSilentCopyId, canonicalIndex, traceByNodeId);
    });
  });

  if (frames.length === 0) return { movedByNodeId, traceByNodeId };

  const rawTraceAlias = new Map<string, string>();
  let previousTraceLeafIds = new Set<string>();
  frames.forEach((frame) => {
    const canonicalIndex = registerChain(frame?.chainId);
    const traceLeaves = collectForestLeafSyntaxNodes(frame?.workspaceForest)
      .map((leaf) => ({
        id: String(leaf.id || '').trim(),
        rawIndex: extractRawTraceMovementIndex(resolveLeafSurface(leaf))
      }))
      .filter((entry) => entry.id && entry.rawIndex);

    if (frame?.movement && canonicalIndex) {
      traceLeaves.forEach(({ id, rawIndex }) => {
        if (!previousTraceLeafIds.has(id) && rawIndex && !rawTraceAlias.has(rawIndex)) {
          rawTraceAlias.set(rawIndex, canonicalIndex);
        }
      });
    }

    previousTraceLeafIds = new Set(traceLeaves.map(({ id }) => id));
  });

  const finalFrame = frames[frames.length - 1];
  collectForestLeafSyntaxNodes(finalFrame?.workspaceForest).forEach((leaf) => {
    const nodeId = String(leaf.id || '').trim();
    if (!nodeId || traceByNodeId.has(nodeId)) return;
    const rawIndex = extractRawTraceMovementIndex(resolveLeafSurface(leaf));
    if (!rawIndex) return;
    const canonicalIndex = rawTraceAlias.get(rawIndex) || (/^\d+$/.test(rawIndex) ? rawIndex : '');
    if (canonicalIndex) {
      traceByNodeId.set(nodeId, canonicalIndex);
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
  if (!node || typeof node !== 'object') return '';
  const label = String(node.label || '').trim();
  const word = String(node.word || '').trim();
  const children = Array.isArray(node.children)
    ? node.children.filter((child): child is SyntaxNode => Boolean(child && typeof child === 'object'))
    : [];

  if (children.length === 0) {
    const rawSurface = (word || label || '∅').trim();
    const nodeId = String(node.id || '').trim();
    const movedIndex = mode === 'growth' && nodeId
      ? movementMaps.movedByNodeId.get(nodeId)
      : undefined;
    const hasRenderableLabelToken = Boolean(
      label &&
      word &&
      label !== word &&
      (
        isLikelySyntacticCategory(label) ||
        (mode === 'growth' && Boolean(movedIndex))
      )
    );
    const attachMovementToLabel = Boolean(
      mode === 'growth' &&
      movedIndex &&
      hasRenderableLabelToken
    );
    const surfaced = mode === 'growth'
      ? (attachMovementToLabel ? rawSurface : applyGrowthMovementNotation(node, rawSurface, movementMaps))
      : rawSurface;
    const token = sanitizeMilesToken(surfaced || '∅');

    if (word) {
      if (hasRenderableLabelToken) {
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

  const promotedMovementIndex = (() => {
    if (mode !== 'growth' || children.length !== 1) return undefined;
    const parentLabel = String(label || word || '').trim();
    if (!parentLabel) return undefined;
    const onlyChild = children[0];
    const childChildren = Array.isArray(onlyChild.children) ? onlyChild.children : [];
    if (childChildren.length > 0) return undefined;
    const parentId = String(node.id || '').trim();
    if (parentId && movementMaps.movedByNodeId.has(parentId)) return undefined;
    const childId = String(onlyChild.id || '').trim();
    if (!childId) return undefined;
    return movementMaps.movedByNodeId.get(childId);
  })();

  if (promotedMovementIndex) {
    const onlyChild = children[0];
    const childSurface = sanitizeMilesToken(String(onlyChild.word || onlyChild.label || '∅').trim() || '∅');
    const promotedLabel = sanitizeMilesToken(appendMovementIndex(label || word || 'X', promotedMovementIndex));
    return `[${promotedLabel} ${childSurface}]`;
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
  movementEvents?: MovementEvent[],
  precomputedMovementMaps?: MovementIndexMaps
): string => {
  if (!tree || typeof tree !== 'object') return '';
  const movementMaps = mode === 'growth'
    ? (precomputedMovementMaps || buildMovementIndexMaps(tree, movementEvents))
    : EMPTY_MOVEMENT_INDEX_MAPS;
  return serializeMilesNode(tree, mode, movementMaps).trim();
};

const EXPLANATION_MOVEMENT_RE = /\b(move(?:ment|d|s|ing)?|internal\s*merge|head[\s-]*move(?:ment)?|raising|raised|trace|copy|a-?bar|a-?move|wh-?move|spec(?:ifier)?[, ]*(?:cp|tp|inflp|ip)|epp)\b/i;
const EXPLANATION_HEDGE_RE = /\b(may|might|possibly|can)\b/gi;
const EXPLANATION_HEADMOVE_RE = /\b(head[\s-]*move(?:ment)?|v\s*-?to\s*-?[ct]|t\s*-?to\s*-?c)\b/i;
const EXPLANATION_WHMOVE_RE = /\b(wh-?move|wh-?movement|wh-?fronting|\[\+wh\]|a-?bar|spec[, ]*cp)\b/i;
const EXPLANATION_AMOVE_RE = /\b(a-?move|a-?movement|spec(?:ifier)?[, ]*tp|epp)\b/i;
const EXPLANATION_INTERNALMERGE_RE = /\binternal\s*merge\b/i;

const splitExplanationSentences = (text: string): string[] =>
  String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const cleanExplanationWhitespace = (text: string): string =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

const ensureExplanationTerminator = (text: string): string => {
  const value = cleanExplanationWhitespace(text);
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
};

const removeWeakHedging = (text: string): string =>
  cleanExplanationWhitespace(String(text || '').replace(EXPLANATION_HEDGE_RE, ''));

const extractMovementClaimsFromSentence = (sentence: string): {
  mentionsMovement: boolean;
  claimsHeadMove: boolean;
  claimsWhMove: boolean;
  claimsAMove: boolean;
  claimsInternalMerge: boolean;
} => {
  const text = String(sentence || '');
  return {
    mentionsMovement: EXPLANATION_MOVEMENT_RE.test(text),
    claimsHeadMove: EXPLANATION_HEADMOVE_RE.test(text),
    claimsWhMove: EXPLANATION_WHMOVE_RE.test(text),
    claimsAMove: EXPLANATION_AMOVE_RE.test(text),
    claimsInternalMerge: EXPLANATION_INTERNALMERGE_RE.test(text)
  };
};

const normalizeMovementOperationForSummary = (operation?: MovementEvent['operation']): string =>
  String(operation || '').trim().toLowerCase().replace(/[^a-z]/g, '');

const extractMovementEventKinds = (movementEvents?: MovementEvent[]): Set<string> => {
  const kinds = new Set<string>();
  (Array.isArray(movementEvents) ? movementEvents : []).forEach((event) => {
    const op = normalizeMovementOperationForSummary(event.operation);
    if (op === 'headmove') kinds.add('head');
    if (op === 'move' || op === 'abarmove' || op === 'amove' || op === 'internalmerge') {
      kinds.add('generic');
    }
    if (op === 'abarmove') kinds.add('wh');
    if (op === 'amove') kinds.add('a');
    if (op === 'internalmerge') kinds.add('internal');
  });
  return kinds;
};

const movementKindFromOperation = (operation?: MovementEvent['operation']): string | null => {
  const op = normalizeMovementOperationForSummary(operation);
  if (op === 'headmove') return 'head';
  if (op === 'abarmove') return 'wh';
  if (op === 'amove') return 'a';
  if (op === 'internalmerge') return 'internal';
  return null;
};

const extractClaimedMovementKindsFromText = (text: string): Set<string> => {
  const kinds = new Set<string>();
  splitExplanationSentences(text).forEach((sentence) => {
    const claims = extractMovementClaimsFromSentence(sentence);
    if (claims.claimsHeadMove) kinds.add('head');
    if (claims.claimsWhMove) kinds.add('wh');
    if (claims.claimsAMove) kinds.add('a');
    if (claims.claimsInternalMerge) kinds.add('internal');
    if (
      claims.mentionsMovement
      && !claims.claimsHeadMove
      && !claims.claimsWhMove
      && !claims.claimsAMove
      && !claims.claimsInternalMerge
    ) {
      kinds.add('generic');
    }
  });
  return kinds;
};

const isCompatibleMovementSentence = (sentence: string, movementKinds: Set<string>): boolean => {
  const claims = extractMovementClaimsFromSentence(sentence);
  if (!claims.mentionsMovement) return true;
  if (/\bor\b/i.test(sentence)) return false;
  const hasGenericPhrasalMovement = movementKinds.has('generic');
  if (claims.claimsHeadMove && !movementKinds.has('head')) return false;
  if (claims.claimsWhMove && !(movementKinds.has('wh') || hasGenericPhrasalMovement)) return false;
  if (claims.claimsAMove && !(movementKinds.has('a') || hasGenericPhrasalMovement)) return false;
  if (claims.claimsInternalMerge && !(movementKinds.has('internal') || hasGenericPhrasalMovement)) return false;
  return true;
};

const joinWithAnd = (items: string[]): string => {
  const values = items.filter(Boolean);
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
};

const isNullLikeSurface = (surface: string): boolean => NULL_SURFACE_RE.test(surface);
const isTraceLikeSurface = (surface: string): boolean => TRACE_SURFACE_RE.test(surface);

const stripMovementIndex = (label: string): string =>
  String(label || '')
    .trim()
    .replace(/[_-]\{?[a-z0-9]+\}?$/i, '');

const normalizeMovementLabelKey = (label?: string): string =>
  stripMovementIndex(String(label || ''))
    .replace(/[’']+$/g, '')
    .replace(/_bar$/i, '')
    .toLowerCase();

const buildNodeIndexForExplanation = (tree?: SyntaxNode | null): Map<string, SyntaxNode> => {
  const byId = new Map<string, SyntaxNode>();
  const visit = (node?: SyntaxNode | null) => {
    if (!node) return;
    const id = String(node.id || '').trim();
    if (id) byId.set(id, node);
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree || undefined);
  return byId;
};

const buildParentIndexForExplanation = (tree?: SyntaxNode | null): Map<string, SyntaxNode> => {
  const parentById = new Map<string, SyntaxNode>();
  const visit = (node?: SyntaxNode | null) => {
    if (!node) return;
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child) => {
      const childId = String(child?.id || '').trim();
      if (childId) parentById.set(childId, node);
      visit(child);
    });
  };
  visit(tree || undefined);
  return parentById;
};

const collectOvertYieldForExplanation = (node?: SyntaxNode | null, words: string[] = []): string[] => {
  if (!node) return words;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) {
    const surface = String(node.word || node.label || '').trim();
    if (surface && !isNullLikeSurface(surface) && !isTraceLikeSurface(surface)) {
      words.push(surface);
    }
    return words;
  }
  children.forEach((child) => collectOvertYieldForExplanation(child, words));
  return words;
};

const getNodeOvertYieldForExplanation = (node?: SyntaxNode | null): string =>
  collectOvertYieldForExplanation(node, []).join(' ').trim();

const isNullLikeNodeForExplanation = (node?: SyntaxNode | null): boolean => {
  if (!node) return false;
  const surface = String(node.word || node.label || '').trim();
  return Boolean(surface) && isNullLikeSurface(surface);
};

const isTraceLikeNodeForExplanation = (node?: SyntaxNode | null): boolean => {
  if (!node) return false;
  const surface = String(node.word || node.label || '').trim();
  return Boolean(surface) && isTraceLikeSurface(surface);
};

const getMovementDisplayLabelForExplanation = (node?: SyntaxNode | null): string => {
  if (!node) return '';
  const stripped = stripMovementIndex(String(node.label || '').trim());
  return stripped || String(node.label || '').trim();
};

const resolveHeadMoveSourceLabel = (
  node: SyntaxNode | undefined,
  parentById: Map<string, SyntaxNode>
): string => {
  if (!node) return '';
  if (!isNullLikeNodeForExplanation(node) && !isTraceLikeNodeForExplanation(node)) {
    return getMovementDisplayLabelForExplanation(node);
  }
  let current = parentById.get(String(node.id || '').trim());
  while (current) {
    const label = getMovementDisplayLabelForExplanation(current);
    if (label && label !== '∅') return label;
    current = parentById.get(String(current.id || '').trim());
  }
  return '';
};

const buildMovementDetailForExplanation = (
  event: MovementEvent,
  nodeById: Map<string, SyntaxNode>,
  parentById: Map<string, SyntaxNode>
): string => {
  const operation = normalizeMovementOperationForSummary(event.operation);
  const fromNode = nodeById.get(String(event.fromNodeId || '').trim());
  const toNode = nodeById.get(String(event.toNodeId || '').trim());
  const traceNode = event.traceNodeId ? nodeById.get(String(event.traceNodeId).trim()) : undefined;
  const note = cleanExplanationWhitespace(String(event.note || ''));

  if (!toNode) {
    return note || 'movement';
  }

  if (operation === 'headmove') {
    const movedHeadSurface = getNodeOvertYieldForExplanation(toNode);
    const movedHead = movedHeadSurface ? `"${movedHeadSurface}"` : 'the head';
    const landingHead = getMovementDisplayLabelForExplanation(toNode);
    const sourceHead = resolveHeadMoveSourceLabel(traceNode || fromNode, parentById);
    const normalizedSource = normalizeMovementLabelKey(sourceHead);
    const normalizedLanding = normalizeMovementLabelKey(landingHead);
    const phrase =
      normalizedSource === 'c' && /^(?:infl|i|t)$/.test(normalizedLanding)
        ? 'lowering'
        : 'head movement';
    if (sourceHead && landingHead && normalizedSource && normalizedLanding && normalizedSource !== normalizedLanding) {
      return `${phrase} of ${movedHead} from ${sourceHead} to ${landingHead}`;
    }
    if (landingHead) {
      return `${phrase} of ${movedHead} to ${landingHead}`;
    }
    return note || 'head movement';
  }

  const movedYield = getNodeOvertYieldForExplanation(toNode);
  const movedLabel = getMovementDisplayLabelForExplanation(toNode);
  const movedDescriptor = movedYield ? `${movedLabel} "${movedYield}"` : movedLabel;
  if (
    traceNode
    && (isTraceLikeNodeForExplanation(traceNode) || isNullLikeNodeForExplanation(traceNode))
    && movedDescriptor
  ) {
    return `movement of ${movedDescriptor} from its lower copy`;
  }
  if (
    fromNode
    && (isTraceLikeNodeForExplanation(fromNode) || isNullLikeNodeForExplanation(fromNode))
    && movedDescriptor
  ) {
    return `movement of ${movedDescriptor} from its lower copy`;
  }
  const sourceLabel = getMovementDisplayLabelForExplanation(fromNode);
  const landingLabel = getMovementDisplayLabelForExplanation(toNode);
  if (sourceLabel && landingLabel) {
    return `movement from ${sourceLabel} to ${landingLabel}`;
  }
  return note || 'movement';
};

const summarizeMovementFromEvents = (tree: SyntaxNode | null | undefined, movementEvents?: MovementEvent[]): string => {
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return 'No movement is posited in this analysis.';

  const nodeById = buildNodeIndexForExplanation(tree);
  const parentById = buildParentIndexForExplanation(tree);
  const details = movementEvents
    .slice(0, 3)
    .map((event) => buildMovementDetailForExplanation(event, nodeById, parentById))
    .filter(Boolean);
  if (details.length > 0) {
    return `The derivation explicitly records ${details.join('; ')}.`;
  }

  const operationOrder: string[] = [];
  movementEvents.forEach((event) => {
    const op = normalizeMovementOperationForSummary(event.operation);
    const key = op || 'move';
    if (!operationOrder.includes(key)) operationOrder.push(key);
  });

  const labelForOperation = (op: string): string => {
    if (op === 'headmove') return 'head movement';
    if (op === 'internalmerge') return 'internal merge';
    if (op === 'amove') return 'A-movement';
    if (op === 'abarmove') return 'A-bar movement';
    return 'movement';
  };

  const parts = operationOrder.map((op) => labelForOperation(op));
  const summary = parts.length > 0
    ? `Movement in this derivation includes ${joinWithAnd(parts)}.`
    : 'Movement is present in this derivation.';
  return summary;
};

const buildSupplementalMovementSummary = (
  compatibleText: string,
  tree: SyntaxNode | null | undefined,
  movementEvents?: MovementEvent[]
): string => {
  if (!Array.isArray(movementEvents) || movementEvents.length === 0) return '';
  const claimedKinds = extractClaimedMovementKindsFromText(compatibleText);
  if (claimedKinds.size === 0) {
    return summarizeMovementFromEvents(tree, movementEvents);
  }

  const missingEvents = movementEvents.filter((event) => {
    const kind = movementKindFromOperation(event.operation);
    if (!kind) return false;
    return !claimedKinds.has(kind);
  });
  if (missingEvents.length === 0) return '';
  return summarizeMovementFromEvents(tree, missingEvents);
};

const movementSignatureForSentence = (sentence: string): string => {
  const claims = extractMovementClaimsFromSentence(sentence);
  if (!claims.mentionsMovement) return '';
  const tags: string[] = [];
  if (claims.claimsHeadMove) tags.push('head');
  if (claims.claimsWhMove) tags.push('wh');
  if (claims.claimsAMove) tags.push('a');
  if (claims.claimsInternalMerge) tags.push('internal');
  if (tags.length === 0) tags.push('generic');
  return tags.sort().join('+');
};

const dedupeMovementSentences = (sentences: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  sentences.forEach((sentence) => {
    const signature = movementSignatureForSentence(sentence);
    if (!signature) {
      out.push(sentence);
      return;
    }
    if (seen.has(signature)) return;
    seen.add(signature);
    out.push(sentence);
  });
  return out;
};

const normalizeExplanationForDisplay = (
  explanation: string,
  movementEvents?: MovementEvent[],
  tree?: SyntaxNode | null
): string => {
  const cleaned = ensureExplanationTerminator(removeWeakHedging(explanation));
  if (cleaned) return cleaned;
  if (Array.isArray(movementEvents) && movementEvents.length > 0) {
    return summarizeMovementFromEvents(tree, movementEvents);
  }
  return 'No explanation provided.';
};

const unwrapQuotedProviderText = (value: string): string => {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string' && parsed.trim()) {
        text = parsed.trim();
      } else {
        text = text.slice(1, -1).trim();
      }
    } catch {
      text = text.slice(1, -1).trim();
    }
  }
  return text.trim();
};

const normalizeProviderSummaryForDisplay = (summary: string): string => {
  const text = unwrapQuotedProviderText(summary);
  if (!text) return '';
  if (
    /^[{\[]/.test(text) &&
    /"(?:analyses|analysis|growthFrames|workspaceForest|noteBindings|movementEvents|tree)"/.test(text)
  ) {
    return '';
  }
  return text
    .replace(/\r/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const summarizeProviderReasoningForDisplay = (summary: string, raw: string, maxChars = 520): string => {
  const cleanedSummary = normalizeProviderSummaryForDisplay(summary);
  const cleanedRaw = normalizeProviderRawForDisplay(raw);
  const base = cleanedRaw || cleanedSummary;
  if (!base) return '';

  const metaIntroRe =
    /^(?:analysis of[^:]*:\s*|deep dive into[^:]*:?|okay[, ]+|here(?:'|’)s how i(?:'|’)m thinking(?: about this sentence)?[, ]*|my immediate thought\??|first[, ]+|let(?:'|’)s\s+)/i;
  const sentenceParts = base
    .replace(/\bSHOW FULL RAW THINKING TRACE\b/gi, '')
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim().replace(/^\d+\.\s*/, '').replace(metaIntroRe, '').trim())
    .filter(Boolean);

  if (sentenceParts.length === 0) {
    return base.length <= maxChars ? base : `${base.slice(0, maxChars).trim()}...`;
  }

  const decisionCueRe =
    /\b(?:because|since|therefore|thus|so|given|evidence|cue|signal|shows?|indicates?|suggests?|supports?|licenses?|forces?|requires?|must|challenge|favou?rs?|prefers?|chooses?|decides?|rather than|instead of|contrast|alternative|standard analysis|word order|agreement|morphology|movement|selection|locality|scope|case|theta|theta-role|raising|control|passive|unaccusative|v2|wh|inversion)\b/i;
  const recapPenaltyRe =
    /\b(?:the analysis projects|the clause architecture|the final tree|spellout yields|surface string|surface order|the sentence is|this is a)\b/i;
  const metaPenaltyRe =
    /\b(?:i immediately recognize|i see|i begin|i'm thinking|here's how i'm thinking|my immediate thought|let's|okay)\b/i;

  const ranked = sentenceParts.map((part, index) => {
    let score = 0;
    if (decisionCueRe.test(part)) score += 4;
    if (/\b(?:rather than|instead of|contrast|alternative)\b/i.test(part)) score += 2;
    if (/\b(?:because|since|given|shows?|indicates?|suggests?)\b/i.test(part)) score += 2;
    if (/\b(?:must|requires?|challenge|standard analysis)\b/i.test(part)) score += 2;
    if (recapPenaltyRe.test(part)) score -= 3;
    if (metaPenaltyRe.test(part)) score -= 4;
    return { part, index, score };
  });

  const chosen = ranked
    .slice()
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .filter((entry) => entry.score > 0)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.part);

  const preferredParts = chosen.length > 0 ? chosen : sentenceParts.slice(0, 2);
  const selected: string[] = [];
  let total = 0;
  for (const part of preferredParts) {
    const nextTotal = total + (selected.length > 0 ? 1 : 0) + part.length;
    if (selected.length >= 3 || nextTotal > maxChars) break;
    selected.push(part);
    total = nextTotal;
  }

  if (selected.length > 0) return selected.join(' ').trim();
  return base.length <= maxChars ? base : `${base.slice(0, maxChars).trim()}...`;
};

const normalizeProviderRawForDisplay = (summary: string): string => {
  const text = unwrapQuotedProviderText(summary);
  if (!text) return '';
  if (
    /^[{\[]/.test(text) &&
    /"(?:analyses|analysis|growthFrames|workspaceForest|noteBindings|movementEvents|tree)"/.test(text)
  ) {
    return '';
  }
  return text
    .replace(/\r/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
};

const truncateReasoningSummary = (summary: string, limit = 900): string => {
  const text = normalizeProviderSummaryForDisplay(summary);
  if (!text || text.length <= limit) return text;
  const boundary = Math.max(
    text.lastIndexOf('. ', limit),
    text.lastIndexOf('\n', limit),
    text.lastIndexOf('; ', limit)
  );
  const cut = boundary >= Math.floor(limit * 0.65) ? boundary + 1 : limit;
  return `${text.slice(0, cut).trim()}...`;
};

const getPreferredGrowthSteps = (parse: ParseResult | null): DerivationStep[] => {
  if (!parse) return [];
  const raw = Array.isArray(parse.rawDerivationSteps) ? parse.rawDerivationSteps : [];
  if (raw.length > 0) return raw;
  return Array.isArray(parse.derivationSteps) ? parse.derivationSteps : [];
};

const normalizeToken = (value?: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

const buildReadableNodeResolvers = (tree?: SyntaxNode | null) => {
  const isStructuralLeafLabel = (value: string) =>
    /^(?:c|c'|cp|infl|infl'|inflp|i|i'|ip|t|t'|tp|v|v'|vp|d|d'|dp|n|n'|np|p|p'|pp|a|a'|ap|q|q'|qp)$/i.test(value);
  const stripStageSuffixes = (value: string) =>
    stringifyLedgerAtom(value).replace(/(?:_(?:base|landing|trace|copy|infl|c|t|v|head|low|high|intermediate))+$/i, '');
  const lexicalHintFromId = (value: string) => {
    const raw = stringifyLedgerAtom(value);
    if (!raw) return '';
    const compact = stripStageSuffixes(raw);
    const pieces = compact.split('_').filter(Boolean);
    if (pieces.length < 2) return '';
    const lexicalPieces = pieces.slice(1).filter((piece) => !/^(?:subj|obj|spec|comp|head|bar|root|matrix|embedded|emb|lower|upper|base|trace|copy|landing|phase|goal|probe|infl|c|t|v|d|n|p|a)$/i.test(piece));
    return lexicalPieces.join(' ').trim();
  };
  const nodeById = new Map<string, SyntaxNode>();
  const aliasToNodeId = new Map<string, string>();
  const visit = (node?: SyntaxNode | null) => {
    if (!node || typeof node !== 'object') return;
    const id = stringifyLedgerAtom(node.id);
    if (id) {
      nodeById.set(id, node);
      const alias = stripStageSuffixes(id);
      if (alias && !aliasToNodeId.has(alias)) aliasToNodeId.set(alias, id);
    }
    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach(visit);
  };
  visit(tree);

  const getNodeByReference = (reference?: string) => {
    const raw = stringifyLedgerAtom(reference);
    if (!raw) return null;
    return nodeById.get(raw) || nodeById.get(aliasToNodeId.get(stripStageSuffixes(raw)) || '') || null;
  };

  const collectVisibleYield = (node?: SyntaxNode | null): string[] => {
    if (!node) return [];
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const word = stringifyLedgerAtom(node.word);
      const label = stringifyLedgerAtom(node.label);
      const surface = word || (!isStructuralLeafLabel(label) ? label : '');
      if (!surface) return [];
      if (/^(∅|Ø|ε|null|epsilon)$/i.test(surface)) return [];
      if (/^(?:t|trace)(?:[_-]?[A-Za-z0-9]+)?$/i.test(surface)) return [];
      return [surface];
    }
    return children.flatMap((child) => collectVisibleYield(child));
  };

  const resolveSurfaceRef = (reference?: string): string => {
    const raw = stringifyLedgerAtom(reference);
    if (!raw) return '';
    const node = getNodeByReference(raw);
    if (!node) {
      const lexicalHint = lexicalHintFromId(raw);
      return lexicalHint || humanizeLedgerFallbackId(normalizeLedgerDisplay(raw, { preferInner: true }));
    }
    const visibleYield = collectVisibleYield(node).join(' ').trim();
    if (visibleYield) return visibleYield;
    const label = stringifyLedgerAtom(node.label);
    if (label) return label;
    const lexicalHint = lexicalHintFromId(raw);
    return lexicalHint || humanizeLedgerFallbackId(normalizeLedgerDisplay(raw, { preferInner: true }));
  };

  const resolveStructuralRef = (reference?: string): string => {
    const raw = stringifyLedgerAtom(reference);
    if (!raw) return '';
    const node = getNodeByReference(raw);
    if (!node) {
      const lexicalHint = lexicalHintFromId(raw);
      if (lexicalHint) {
        const head = humanizeLedgerStructuralHead(raw);
        return head ? `${head} (${lexicalHint})` : lexicalHint;
      }
      return humanizeLedgerFallbackId(normalizeLedgerDisplay(raw, { preferInner: false }));
    }
    const label = stringifyLedgerAtom(node.label);
    const visibleYield = collectVisibleYield(node).join(' ').trim();
    if (label && visibleYield && normalizeToken(label) !== normalizeToken(visibleYield)) {
      return `${label} (${visibleYield})`;
    }
    return label || visibleYield || humanizeLedgerFallbackId(normalizeLedgerDisplay(raw, { preferInner: false }));
  };

  const resolveReadableReference = (preferred?: string, fallbackNodeRef?: string, { structural = false } = {}): string => {
    const resolver = structural ? resolveStructuralRef : resolveSurfaceRef;
    const preferredRaw = stringifyLedgerAtom(preferred);
    const fallbackRaw = stringifyLedgerAtom(fallbackNodeRef);

    if (preferredRaw) {
      const resolvedPreferred = resolver(preferredRaw);
      if (resolvedPreferred && resolvedPreferred !== humanizeLedgerFallbackId(preferredRaw)) {
        return resolvedPreferred;
      }
      if (!/[A-Za-z]+_[A-Za-z0-9_]+/.test(preferredRaw)) {
        return preferredRaw;
      }
      if (resolvedPreferred) return resolvedPreferred;
    }

    if (fallbackRaw) {
      const resolvedFallback = resolver(fallbackRaw);
      if (resolvedFallback) return resolvedFallback;
    }

    return preferredRaw || fallbackRaw || '';
  };

  return {
    resolveSurfaceRef,
    resolveStructuralRef,
    resolveReadableReference
  };
};

interface ReplayLedgerAttachment {
  preferredStepId?: string;
  block: ReplayLedgerBlock;
}

const REPLAY_LEDGER_OPERATIONS = new Set<DerivationStep['operation']>([
  'FeatureLedger',
  'CaseAssignment',
  'ThetaAssignment',
  'Selection',
  'Binding',
  'ClausalDependency'
]);

const isReplayLedgerOperation = (operation?: DerivationStep['operation'] | string): boolean =>
  REPLAY_LEDGER_OPERATIONS.has(String(operation || '').trim() as DerivationStep['operation']);

const buildReplayLedgerAttachments = (
  parse: ParseResult,
  workspaceAfter: string[],
  rootId?: string,
  rootLabel?: string
): ReplayLedgerAttachment[] => {
  const {
    resolveReadableReference
  } = buildReadableNodeResolvers(parse.tree);
  const ledgerAttachments: ReplayLedgerAttachment[] = [];

  const appendLedgerBlock = (
    title: string,
    lines: string[],
    preferredStepId?: string
  ) => {
    const cleanedLines = lines.map((line) => stringifyLedgerAtom(line)).filter(Boolean);
    if (cleanedLines.length === 0) return;
    ledgerAttachments.push({
      preferredStepId: stringifyLedgerAtom(preferredStepId) || undefined,
      block: { title, lines: cleanedLines }
    });
  };

  const appendAnchoredLedgerEntries = <T extends { stepIds?: string[] }>(
    title: string,
    entries: T[],
    formatEntry: (entry: T) => string
  ) => {
    const linesByStep = new Map<string, string[]>();
    const unanchoredLines: string[] = [];

    entries.forEach((entry) => {
      const line = stringifyLedgerAtom(formatEntry(entry));
      if (!line) return;
      const preferredStepIds = Array.isArray(entry.stepIds)
        ? entry.stepIds.map((stepId) => stringifyLedgerAtom(stepId)).filter(Boolean)
        : [];
      if (preferredStepIds.length === 0) {
        unanchoredLines.push(line);
        return;
      }
      preferredStepIds.forEach((stepId) => {
        const existing = linesByStep.get(stepId) || [];
        existing.push(line);
        linesByStep.set(stepId, existing);
      });
    });

    linesByStep.forEach((lines, stepId) => appendLedgerBlock(title, lines, stepId));
    appendLedgerBlock(title, unanchoredLines);
  };

  const featureLinesByStep = new Map<string, string[]>();
  const unanchoredFeatureLines: string[] = [];
  (parse.featureLedger || []).forEach((entry) => {
      const line = (() => {
      const node = stringifyLedgerAtom(entry.nodeId);
      const value = stringifyLedgerAtom(entry.value);
      const status = stringifyLedgerAtom(entry.status);
      const source = stringifyLedgerAtom(entry.sourceStepId);
      const parts = [
        node ? `${node}: ` : '',
        entry.feature,
        value ? `=${value}` : '',
        status ? ` [${status}]` : '',
        source ? ` @ ${source}` : '',
        entry.note ? ` - ${entry.note}` : ''
      ];
      return parts.join('');
      })();
      if (!line) return;
      const sourceStepId = stringifyLedgerAtom(entry.sourceStepId);
      if (sourceStepId) {
        const existing = featureLinesByStep.get(sourceStepId) || [];
        existing.push(line);
        featureLinesByStep.set(sourceStepId, existing);
      } else {
        unanchoredFeatureLines.push(line);
      }
    });
  featureLinesByStep.forEach((lines, stepId) => appendLedgerBlock('Feature Ledger', lines, stepId));
  appendLedgerBlock('Feature Ledger', unanchoredFeatureLines);

  appendAnchoredLedgerEntries(
    'Case Assignment',
    parse.caseAssignments || [],
    (entry) => {
      const assignee =
        resolveReadableReference(
          stringifyLedgerAtom(entry.assigneeLabel),
          stringifyLedgerAtom(entry.nodeId),
          { structural: false }
        ) ||
        'Unspecified node';
      const assigner =
        resolveReadableReference(
          stringifyLedgerAtom(entry.assigner),
          stringifyLedgerAtom(entry.assigner),
          { structural: true }
        );
      return formatCaseAssignmentReplayEntry({
        assignee,
        assignedCase: entry.case,
        assigner,
        mechanism: entry.mechanism,
        position: entry.position
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Theta Roles',
    parse.argumentStructure || [],
    (entry) => {
      const referent =
        resolveReadableReference(
          stringifyLedgerAtom(entry.referent),
          stringifyLedgerAtom(entry.nodeId),
          { structural: true }
        ) ||
        '';
      const predicate =
        resolveReadableReference(
          stringifyLedgerAtom(entry.predicate),
          stringifyLedgerAtom(entry.predicate),
          { structural: true }
        );
      const introducer =
        resolveReadableReference(
          stringifyLedgerAtom(entry.introducer),
          stringifyLedgerAtom(entry.introducer),
          { structural: true }
        );
      return formatThetaAssignmentReplayEntry({
        referent,
        role: entry.role,
        predicate,
          introducer,
          position: entry.position
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Selection',
    parse.selectionLedger || [],
    (entry) => {
      const selector =
        resolveReadableReference(
          stringifyLedgerAtom(entry.selectorHead) || stringifyLedgerAtom(entry.selectorLabel),
          stringifyLedgerAtom(entry.selectorNodeId),
          { structural: true }
        ) ||
        'Unspecified selector';
      const selectedLabel =
        resolveReadableReference(
          stringifyLedgerAtom(entry.selectedLabel),
          stringifyLedgerAtom(entry.selectedNodeId),
          { structural: true }
        );
      return formatSelectionReplayEntry({
        selector,
        selectedLabel,
        selectedCategory: entry.selectedCategory,
        relation: entry.relation
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Binding',
    parse.bindingLedger || [],
    (entry) => {
      const antecedent =
        resolveReadableReference(
          stringifyLedgerAtom(entry.antecedentLabel),
          stringifyLedgerAtom(entry.antecedentNodeId),
          { structural: false }
        ) ||
        'Unspecified antecedent';
      const dependent =
        resolveReadableReference(
          stringifyLedgerAtom(entry.dependentLabel),
          stringifyLedgerAtom(entry.dependentNodeId),
          { structural: false }
        ) ||
        'unspecified dependent';
      return formatBindingReplayEntry({
        antecedent,
        dependent,
        principle: entry.principle,
        relation: entry.relation,
        status: entry.status
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Clausal Dependencies',
    parse.clausalDependencies || [],
    (entry) => {
      const subtype = stringifyLedgerAtom(entry.subtype);
      const type = stringifyLedgerAtom(entry.type) || 'dependency';
      const label = subtype || type;
      const controller =
        resolveReadableReference(
          stringifyLedgerAtom(entry.controllerLabel),
          stringifyLedgerAtom(entry.controllerNodeId),
          { structural: false }
        );
      const dependent =
        resolveReadableReference(
          stringifyLedgerAtom(entry.dependentLabel),
          stringifyLedgerAtom(entry.dependentNodeId),
          { structural: true }
        );
      const predicate =
        resolveReadableReference(
          stringifyLedgerAtom(entry.predicateLabel),
          stringifyLedgerAtom(entry.predicateNodeId),
          { structural: true }
        );
      const clause =
        resolveReadableReference(
          stringifyLedgerAtom(entry.clauseLabel),
          stringifyLedgerAtom(entry.clauseNodeId),
          { structural: true }
        );
      return formatClausalDependencyReplayEntry({
        label,
        controller,
        dependent,
        predicate,
        clause,
        evidence: entry.evidence
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Agreement',
    parse.agreementLedger || [],
    (entry) => {
      const probe =
        resolveReadableReference(
          stringifyLedgerAtom(entry.probeLabel),
          stringifyLedgerAtom(entry.probeNodeId),
          { structural: true }
        );
      const goal =
        resolveReadableReference(
          stringifyLedgerAtom(entry.goalLabel),
          stringifyLedgerAtom(entry.goalNodeId),
          { structural: false }
        );
      return formatAgreementReplayEntry({
        probe,
        goal,
        feature: entry.feature,
        value: entry.value,
        morphology: entry.morphology,
        status: entry.status,
        direction: entry.direction,
        domain: entry.domain,
        defaultValue: entry.defaultValue
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Predicate Class',
    parse.predicateClassLedger || [],
    (entry) => {
      const predicate =
        resolveReadableReference(
          stringifyLedgerAtom(entry.predicateLabel),
          stringifyLedgerAtom(entry.predicateNodeId),
          { structural: true }
        );
      return formatPredicateClassReplayEntry({
        predicate,
        classification: entry.classification,
        subtype: entry.subtype,
        diagnostics: entry.diagnostics,
        evidence: entry.evidence
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Probe Ledger',
    parse.probeLedger || [],
    (entry) => {
      const probe =
        resolveReadableReference(
          stringifyLedgerAtom(entry.probeLabel),
          stringifyLedgerAtom(entry.probeNodeId),
          { structural: true }
        );
      const goal =
        resolveReadableReference(
          stringifyLedgerAtom(entry.goalLabel),
          stringifyLedgerAtom(entry.goalNodeId),
          { structural: true }
        );
      return formatProbeReplayEntry({
        probe,
        goal,
        feature: entry.feature,
        direction: entry.direction,
        domain: entry.domain,
        locality: entry.locality,
        outcome: entry.outcome
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Null Elements',
    parse.nullElementLedger || [],
    (entry) => {
      const controller =
        resolveReadableReference(
          stringifyLedgerAtom(entry.controllerLabel),
          stringifyLedgerAtom(entry.controllerNodeId),
          { structural: false }
        );
      const antecedent =
        resolveReadableReference(
          stringifyLedgerAtom(entry.antecedentLabel),
          stringifyLedgerAtom(entry.antecedentNodeId),
          { structural: false }
        );
      return formatNullElementReplayEntry({
        label: entry.label,
        kind: entry.kind,
        controller,
        antecedent,
        licensing: entry.licensing,
        evidence: entry.evidence
      });
    }
  );

  appendAnchoredLedgerEntries(
    'Diagnostics',
    parse.diagnosticLedger || [],
    (entry) =>
      formatDiagnosticReplayEntry({
        diagnostic: entry.diagnostic,
        observation: entry.observation,
        supports: entry.supports,
        status: entry.status,
        evidence: entry.evidence
      })
    
  );

  appendAnchoredLedgerEntries(
    'Parameters',
    parse.parameterLedger || [],
    (entry) =>
      formatParameterReplayEntry({
        parameter: entry.parameter,
        value: entry.value,
        domain: entry.domain,
        language: entry.language,
        evidence: entry.evidence
      })
    
  );

  appendAnchoredLedgerEntries(
    'Information Structure',
    parse.informationStructureLedger || [],
    (entry) =>
      formatInformationStructureReplayEntry({
        label:
          resolveReadableReference(
            stringifyLedgerAtom(entry.label),
            stringifyLedgerAtom(entry.nodeId),
            { structural: false }
          ),
        role: entry.role,
        scope: entry.scope,
        evidence: entry.evidence
      })
    
  );

  appendAnchoredLedgerEntries(
    'Operator Scope',
    parse.operatorScopeLedger || [],
    (entry) =>
      formatOperatorScopeReplayEntry({
        operator:
          resolveReadableReference(
            stringifyLedgerAtom(entry.operatorLabel),
            stringifyLedgerAtom(entry.operatorNodeId),
            { structural: true }
          ),
        scope:
          resolveReadableReference(
            stringifyLedgerAtom(entry.scopeLabel),
            stringifyLedgerAtom(entry.scopeNodeId),
            { structural: true }
          ),
        operatorType: entry.operatorType,
        relation: entry.relation,
        evidence: entry.evidence
      })
    
  );

  appendAnchoredLedgerEntries(
    'Voice & Valency',
    parse.voiceValencyLedger || [],
    (entry) =>
      formatVoiceValencyReplayEntry({
        predicate:
          resolveReadableReference(
            stringifyLedgerAtom(entry.predicateLabel),
            stringifyLedgerAtom(entry.predicateNodeId),
            { structural: true }
          ),
        voice: entry.voice,
        valency: entry.valency,
        externalArgument: entry.externalArgument,
        internalArgument: entry.internalArgument,
        evidence: entry.evidence
      })
    
  );

  appendAnchoredLedgerEntries(
    'Linearization',
    parse.linearizationLedger || [],
    (entry) =>
      formatLinearizationReplayEntry({
        domain:
          resolveReadableReference(
            stringifyLedgerAtom(entry.domainLabel),
            stringifyLedgerAtom(entry.domainNodeId),
            { structural: true }
          ),
        order: entry.order,
        mechanism: entry.mechanism,
        effect: entry.effect,
        evidence: entry.evidence || entry.note
      })
    
  );

  appendAnchoredLedgerEntries(
    'Locality',
    parse.localityLedger || [],
    (entry) =>
      formatLocalityReplayEntry({
        dependencyType: entry.dependencyType,
        moving:
          resolveReadableReference(
            stringifyLedgerAtom(entry.movingLabel),
            stringifyLedgerAtom(entry.movingNodeId),
            { structural: false }
          ),
        landing:
          resolveReadableReference(
            stringifyLedgerAtom(entry.landingLabel),
            stringifyLedgerAtom(entry.landingNodeId),
            { structural: true }
          ),
        boundary: entry.boundary,
        status: entry.status,
        evidence: entry.evidence || entry.note
      })
    
  );

  appendAnchoredLedgerEntries(
    'Predication',
    parse.predicationLedger || [],
    (entry) =>
      formatPredicationReplayEntry({
        predicate:
          resolveReadableReference(
            stringifyLedgerAtom(entry.predicateLabel),
            stringifyLedgerAtom(entry.predicateNodeId),
            { structural: true }
          ),
        subject:
          resolveReadableReference(
            stringifyLedgerAtom(entry.subjectLabel),
            stringifyLedgerAtom(entry.subjectNodeId),
            { structural: false }
          ),
        relation: entry.relation,
        evidence: entry.evidence
      })
    
  );

  return ledgerAttachments;
};

const attachReplayLedgerBlocksToStructuralSteps = (
  structuralSteps: DerivationStep[],
  ledgerAttachments: ReplayLedgerAttachment[],
  fallbackSteps: DerivationStep[] = []
): { structuralSteps: DerivationStep[]; fallbackSteps: DerivationStep[] } => {
  const normalizedStructuralSteps = structuralSteps.map((step) => ({
    ...step,
    ledgerBlocks: Array.isArray(step.ledgerBlocks) ? [...step.ledgerBlocks] : []
  }));
  const normalizedFallbackSteps = fallbackSteps.map((step) => ({
    ...step,
    ledgerBlocks: Array.isArray(step.ledgerBlocks) ? [...step.ledgerBlocks] : []
  }));
  const stepIndexById = new Map<string, number>();
  normalizedStructuralSteps.forEach((step, index) => {
    const stepId = stringifyLedgerAtom(step.stepId);
    if (stepId) stepIndexById.set(stepId, index);
  });
  const fallbackStructuralIndex = normalizedStructuralSteps.length > 0 ? normalizedStructuralSteps.length - 1 : -1;
  const fallbackStepIndex = normalizedFallbackSteps.length > 0 ? normalizedFallbackSteps.length - 1 : -1;

  ledgerAttachments.forEach(({ preferredStepId, block }) => {
    const preferredIndex = preferredStepId ? stepIndexById.get(preferredStepId) : undefined;
    const targetStructuralIndex = preferredIndex ?? fallbackStructuralIndex;
    if (targetStructuralIndex >= 0) {
      normalizedStructuralSteps[targetStructuralIndex].ledgerBlocks!.push(block);
      return;
    }
    if (fallbackStepIndex >= 0) {
      normalizedFallbackSteps[fallbackStepIndex].ledgerBlocks!.push(block);
    }
  });

  return {
    structuralSteps: normalizedStructuralSteps,
    fallbackSteps: normalizedFallbackSteps
  };
};

const ensureReplaySpelloutStep = (parse: ParseResult | null): DerivationStep[] | undefined => {
  if (!parse) return undefined;
  const existing = getPreferredGrowthSteps(parse);
  const spelloutSteps = existing.filter((step) => String(step?.operation || '').trim() === 'SpellOut');
  const structuralSteps = existing.filter((step) => {
    const operation = String(step?.operation || '').trim();
    return operation !== 'SpellOut' && !isReplayLedgerOperation(operation);
  });
  const lastStructural = structuralSteps[structuralSteps.length - 1];
  const rootId = String(parse.tree?.id || '').trim() || undefined;
  const rootLabel = String(parse.tree?.label || '').trim() || 'Tree';
  const workspaceSnapshot = Array.isArray(lastStructural?.workspaceAfter) && lastStructural.workspaceAfter.length > 0
    ? lastStructural.workspaceAfter
    : [rootLabel];
  const ledgerAttachments = buildReplayLedgerAttachments(parse, workspaceSnapshot, rootId, rootLabel);
  const surfaceOrder = Array.isArray(parse.surfaceOrder)
    ? parse.surfaceOrder.map((token) => String(token || '').trim()).filter(Boolean)
    : [];
  const buildDeterministicReplaySpelloutNote = (tokens: string[]): string => {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return 'Final spellout of the committed surface order.';
    }
    return `Committed surface order: ${tokens.join(' ')}`;
  };
  const ensuredSpellout = spelloutSteps.length > 0
    ? spelloutSteps.map((step) => {
        const effectiveSpelloutOrder = Array.isArray(step?.spelloutOrder) && step.spelloutOrder.length > 0
          ? step.spelloutOrder.map((token) => String(token || '').trim()).filter(Boolean)
          : surfaceOrder;
        return {
          ...step,
          targetNodeId: step?.targetNodeId || rootId,
          targetLabel: step?.targetLabel || rootLabel,
          sourceNodeIds: Array.isArray(step?.sourceNodeIds) && step.sourceNodeIds.length > 0
            ? step.sourceNodeIds
            : (rootId ? [rootId] : undefined),
          sourceLabels: Array.isArray(step?.sourceLabels) && step.sourceLabels.length > 0
            ? step.sourceLabels
            : [rootLabel],
          recipe: step?.recipe || `SpellOut(${rootLabel})`,
          spelloutOrder: effectiveSpelloutOrder,
          note: buildDeterministicReplaySpelloutNote(effectiveSpelloutOrder)
        };
      })
    : (surfaceOrder.length > 0
      ? [
          {
            operation: 'SpellOut',
            targetNodeId: rootId,
            targetLabel: rootLabel,
            sourceNodeIds: rootId ? [rootId] : undefined,
            sourceLabels: [rootLabel],
            recipe: 'SpellOut',
            workspaceAfter: [rootLabel],
            spelloutOrder: surfaceOrder,
            note: buildDeterministicReplaySpelloutNote(surfaceOrder)
          }
        ]
      : []);

  const attachedReplay = attachReplayLedgerBlocksToStructuralSteps(structuralSteps, ledgerAttachments, ensuredSpellout);
  const replaySteps = [...attachedReplay.structuralSteps, ...attachedReplay.fallbackSteps];
  return replaySteps.length > 0 ? replaySteps : undefined;
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
  const [isInputVisible, setIsInputVisible] = useState(!showcaseMode);
  const [devCaptureMode, setDevCaptureMode] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [keyPromptMode, setKeyPromptMode] = useState<KeyPromptMode>('none');
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [modelRoute, setModelRoute] = useState<ModelMode>('local');
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
  const selectedModelLabel = MODEL_ROUTE_LABELS[modelRoute];
  const modelLabel = formatModelLabel(analysisBundle?.modelUsed);
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  const resolvedMovementLinks = useMemo(() => {
    if (!activeParse) return [];
    return resolveMovementEventLinks(activeParse.tree, activeParse.movementEvents, framework);
  }, [activeParse, framework]);
  const growthMovementMaps = useMemo(() => {
    if (!activeParse) return EMPTY_MOVEMENT_INDEX_MAPS;
    const baseMaps = buildMovementIndexMaps(activeParse.tree, activeParse.movementEvents, framework);
    return buildGrowthFirstMovementMaps(activeParse, baseMaps);
  }, [activeParse, framework]);
  const replayDerivationSteps = useMemo(() => ensureReplaySpelloutStep(activeParse), [activeParse]);
  const canopyMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'canopy');
  }, [activeParse]);
  const growthMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'growth', activeParse.movementEvents, growthMovementMaps);
  }, [activeParse, growthMovementMaps]);
  const normalizedExplanation = useMemo(() => {
    if (!activeParse) return '';
    return normalizeExplanationForDisplay(activeParse.explanation, activeParse.movementEvents, activeParse.tree);
  }, [activeParse]);
  const providerReasoningRaw = useMemo(
    () => normalizeProviderRawForDisplay(String(activeParse?.provenance?.providerReasoningRaw || '')),
    [activeParse]
  );
  const providerReasoningSummary = useMemo(
    () => summarizeProviderReasoningForDisplay(
      String(activeParse?.provenance?.providerReasoningSummary || ''),
      String(activeParse?.provenance?.providerReasoningRaw || '')
    ),
    [activeParse]
  );
  const providerReasoningPreview = useMemo(
    () => truncateReasoningSummary(providerReasoningSummary, 780),
    [providerReasoningSummary]
  );
  const notesSecondPassReasoningRaw = useMemo(
    () => normalizeProviderRawForDisplay(String(activeParse?.provenance?.notesSecondPassReasoningRaw || '')),
    [activeParse]
  );
  const notesSecondPassReasoningSummary = useMemo(
    () => summarizeProviderReasoningForDisplay(
      String(activeParse?.provenance?.notesSecondPassReasoningSummary || ''),
      String(activeParse?.provenance?.notesSecondPassReasoningRaw || '')
    ),
    [activeParse]
  );
  const notesSecondPassReasoningPreview = useMemo(
    () => truncateReasoningSummary(notesSecondPassReasoningSummary, 420),
    [notesSecondPassReasoningSummary]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const target = window as any;
    target.__BABEL_DEV_SET_ANALYSIS__ = (bundle: ParseBundle, options: {
      sentence?: string;
      framework?: 'xbar' | 'minimalism';
      modelRoute?: ModelMode;
    } = {}) => {
      setAnalysisBundle(bundle);
      const nextSentence = String(options.sentence || '').trim();
      if (nextSentence) {
        setParsedSentence(nextSentence);
        setInput(nextSentence);
      }
      if (options.framework) setFramework(options.framework);
      if (options.modelRoute) setModelRoute(coerceModelRoute(options.modelRoute));
      setActiveParseIndex(0);
      setActiveTab('tree');
      setError(null);
      setCopiedCodeKey(null);
      setNeedsKey(false);
      setKeyPromptMode('none');
      setIsInputVisible(true);
      setIsInputExpanded(true);
      setWorkspaceView('arboretum');
      setLoading(false);
    };
    target.__BABEL_DEV_SET_TAB__ = (tab: AppTab) => {
      if (tab === 'tree' || tab === 'growth' || tab === 'notes') {
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
  }, []);

  useEffect(() => {
    const checkKeyStatus = async () => {
      const aistudio = (window as any).aistudio;
      if (aistudio && typeof aistudio.hasSelectedApiKey === 'function') {
        const hasKey = await aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setNeedsKey(true);
          setKeyPromptMode('gemini');
        }
      }
    };
    checkKeyStatus();
  }, []);

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

  const handleOpenKeySelection = async () => {
    const aistudio = (window as any).aistudio;
    if (aistudio && typeof aistudio.openSelectKey === 'function') {
      try {
        await aistudio.openSelectKey();
        setNeedsKey(false);
        setKeyPromptMode('none');
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
      if (isExternalApiModelMode(modelRoute)) {
        setNeedsKey(true);
        setKeyPromptMode('external');
        setError(`${MODEL_ROUTE_LABELS[modelRoute]} requires an API key. This frontend mode is not wired yet.`);
        return;
      }

      const data = await parseSentence(input, framework, modelRoute);
      setAnalysisBundle(data);
      setModelRoute(coerceModelRoute(data.requestedModelRoute || modelRoute));
      setParsedSentence(input.trim());
      setActiveParseIndex(0);
      setActiveTab('tree');
      setCopiedCodeKey(null);
      setNeedsKey(false);
      setKeyPromptMode('none');
    } catch (err: unknown) {
      const uiError = resolveUiError(err);
      setNeedsKey(uiError.needsKey);
      setKeyPromptMode(uiError.keyPromptMode);
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
    setModelRoute(coerceModelRoute(entry.bundle.requestedModelRoute || inferModelRouteFromModel(entry.bundle.modelUsed)));
    setActiveParseIndex(nextParseIndex);
    setActiveTab('tree');
    setError(null);
    setCopiedCodeKey(null);
    setNeedsKey(false);
    setKeyPromptMode('none');
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
                          {framework === 'xbar' ? 'X̄' : 'vP'}
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
                          ? `Selected route: ${selectedModelLabel}. Last parse used: ${modelLabel}.`
                          : 'Choose parsing model route'
                      }
                    >
                      {MODEL_MODE_PILLS.map((option) => {
                        const active = modelRoute === option.id;
                        return (
                          <button
                            key={option.id}
                            onClick={() => {
                              setModelRoute(option.id);
                              setError(null);
                              setNeedsKey(false);
                              setKeyPromptMode('none');
                            }}
                            className={`flex items-center gap-2 text-[9px] font-black px-3.5 md:px-4 py-2 rounded-full border tracking-[0.18em] md:tracking-widest uppercase shadow-inner whitespace-nowrap transition-all ${
                              active ? option.activeClassName : option.className
                            }`}
                            title={option.keyRequired ? `${option.label} requires an API key and is not wired yet.` : option.label}
                          >
                            {option.keyRequired ? <Key size={10} /> : <Zap size={10} className={active ? 'fill-current' : ''} />}
                            {option.label}
                          </button>
                        );
                      })}
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

      <main className="flex-1 relative flex flex-col overflow-hidden">
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
            <div className="loading-overlay absolute inset-0 z-50 bg-[#020806]/95 backdrop-blur-xl flex flex-col items-center justify-center gap-10 animate-in fade-in duration-700">
              <div className="relative">
                <div className="absolute inset-0 bg-emerald-500/20 blur-[80px] rounded-full scale-150 animate-pulse"></div>
                <div className="relative z-10 w-32 h-32 rounded-full border border-white/5 flex items-center justify-center bg-black/20 backdrop-blur-sm shadow-inner">
                  <div className="absolute inset-0 rounded-full border-[6px] border-emerald-950/50 border-t-emerald-500 animate-spin shadow-[0_0_100px_rgba(16,185,129,0.2)]"></div>
                  <RootLogo
                    size={104}
                    shape="circle"
                    blend={true}
                    zoom={0.92}
                    className="animate-pulse"
                  />
                </div>
              </div>
              <div className="text-center z-10 min-h-[88px] flex flex-col justify-start">
                <p className="text-white font-black serif italic text-2xl mb-1">Synthesizing Neural Roots...</p>
                <p className="text-emerald-500/40 font-black uppercase text-[9px] tracking-[0.7em]">Deep Parsing {framework === 'xbar' ? 'X-Bar' : 'Minimalist'} Structures</p>
              </div>
            </div>
          )}

          {!loading && activeParse && (activeTab === 'tree' || activeTab === 'growth') ? (
            <TreeVisualizer 
              data={activeParse.tree} 
              animated={activeTab === 'growth'} 
              derivationSteps={replayDerivationSteps}
              growthFrames={activeParse.growthFrames}
              movementEvents={activeParse.movementEvents}
              resolvedMovementLinks={resolvedMovementLinks}
              movementMaps={growthMovementMaps}
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
                        <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Structural Genealogy ({framework === 'xbar' ? 'X-Bar' : 'Minimalism'})</h2>
                      </div>
                      <p className="text-emerald-50/90 leading-relaxed italic serif text-lg md:text-2xl border-l-2 border-emerald-500/20 pl-5 md:pl-8">"{normalizedExplanation}"</p>
                      {providerReasoningSummary && (
                        <div className="mb-6 md:mb-8 bg-black/35 border border-emerald-500/10 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-7 shadow-inner">
                          <div className="flex items-center gap-3 mb-3">
                            <div className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 text-emerald-400 flex items-center justify-center">
                              <Brain size={18} />
                            </div>
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Provider Reasoning Summary</p>
                          </div>
                          <p className="text-emerald-50/85 leading-relaxed serif text-base md:text-xl whitespace-pre-wrap">
                            {providerReasoningPreview || providerReasoningSummary}
                          </p>
                          {providerReasoningRaw && providerReasoningRaw !== (providerReasoningPreview || providerReasoningSummary) && (
                            <details className="mt-4 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3">
                              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300/75">
                                Show Full Raw Thinking Trace
                              </summary>
                              <pre className="mt-3 whitespace-pre-wrap break-words text-xs md:text-sm leading-relaxed text-emerald-50/72 serif">
                                {providerReasoningRaw}
                              </pre>
                            </details>
                          )}
                          {notesSecondPassReasoningSummary && (
                            <div className="mt-5 pt-5 border-t border-white/5">
                              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/65 mb-2">Notes Pass Summary</p>
                              <p className="text-emerald-50/65 leading-relaxed serif text-sm md:text-lg whitespace-pre-wrap">
                                {notesSecondPassReasoningPreview || notesSecondPassReasoningSummary}
                              </p>
                              {notesSecondPassReasoningRaw && notesSecondPassReasoningRaw !== (notesSecondPassReasoningPreview || notesSecondPassReasoningSummary) && (
                                <details className="mt-3 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3">
                                  <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300/60">
                                    Show Full Raw Notes Pass Reasoning
                                  </summary>
                                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs md:text-sm leading-relaxed text-emerald-50/60 serif">
                                    {notesSecondPassReasoningRaw}
                                  </pre>
                                </details>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                  </div>

                  {(canopyMilesNotation || growthMilesNotation) && (
                    <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
                       <div className="flex items-center justify-between mb-6 md:mb-8 gap-4">
                          <div className="flex items-center gap-4 md:gap-5">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-500 border border-white/10">
                              <Layers size={24} />
                            </div>
                            <div>
                              <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Labeled Bracketing</h2>
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

                          {growthMilesNotation && (
                            <div className="bg-black/40 p-5 md:p-8 rounded-[1.5rem] md:rounded-[2rem] border border-white/5 shadow-inner">
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
                              <code className="text-emerald-400 mono text-sm md:text-lg break-all leading-relaxed opacity-90 selection:bg-emerald-500/30">
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
            <div className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 z-30 flex flex-col gap-3 md:gap-4">
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
                        <div className="mb-4 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-2xl flex flex-col gap-3 text-rose-400 text-xs shadow-inner">
                          <div className="flex items-center gap-3 italic serif">
                            <AlertTriangle size={14} className="shrink-0" /> {error}
                          </div>
                          {needsKey && keyPromptMode === 'gemini' && (
                            <button
                              onClick={handleOpenKeySelection}
                              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-rose-500/20 border border-rose-500/30 hover:bg-rose-500/40 transition-all font-black uppercase tracking-widest text-[10px] text-rose-200 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                            >
                              <Key size={12} />
                              Renew API Credentials
                            </button>
                          )}
                          {needsKey && keyPromptMode === 'external' && (
                            <div className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] font-black uppercase tracking-widest text-amber-200">
                              <Key size={12} />
                              External API Key Required
                            </div>
                          )}
                        </div>
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
      <footer className="bg-black/80 border-t border-white/10 py-4 px-10 shrink-0 z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
        <div className="max-w-[2000px] mx-auto flex items-center justify-between text-[8px] font-black text-emerald-900/50 uppercase tracking-[0.5em]">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-3"><Layers size={12} /> Sylvan Logic Engine</span>
            <span className="h-3 w-px bg-white/10"></span>
            <span className="flex items-center gap-3"><TreeDeciduous size={12} /> Deep Structural Formalism</span>
          </div>
          <div className="flex items-center gap-6">
            {needsKey && keyPromptMode === 'gemini' && (
              <button 
                onClick={handleOpenKeySelection}
                className="flex items-center gap-2 text-rose-500/80 hover:text-rose-400 transition-colors"
              >
                <Key size={10} /> Key Missing/Invalid - Update
              </button>
            )}
            {needsKey && keyPromptMode === 'external' && (
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
