import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseSentence } from './services/geminiService';
import { DerivationStep, MovementEvent, ParseBundle, ParseResult, SyntaxNode } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import RootLogo from './components/RootLogo';
import {
  buildMovementIndexMaps,
  resolveMovementEventLinks,
  MovementIndexMaps,
  EMPTY_MOVEMENT_INDEX_MAPS
} from './movementEvents';
import { 
  RotateCcw, 
  Sparkles,
  TreeDeciduous,
  AlertTriangle,
  Layers,
  Zap,
  Info,
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
  if (!model) return 'Gemini 3.1 Flash Lite';
  if (model === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash Lite';
  if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
  if (model === 'gemini-3-pro-preview') return 'Gemini 3 Pro';
  return model.replace(/^gemini-/i, 'Gemini ').replace(/-preview$/i, '');
};

type ModelRoute = 'flash-lite' | 'pro';

const inferModelRouteFromModel = (modelUsed?: string): ModelRoute => {
  const model = String(modelUsed || '').trim().toLowerCase();
  if (!model) return 'flash-lite';
  return model.includes('pro') ? 'pro' : 'flash-lite';
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

const pruneCanopyMovementArtifacts = (node: SyntaxNode, isRoot = true): SyntaxNode | null => {
  const children = Array.isArray(node.children) ? node.children : [];
  const prunedChildren = children
    .map((child) => pruneCanopyMovementArtifacts(child, false))
    .filter((child): child is SyntaxNode => Boolean(child));

  if (prunedChildren.length === 0) {
    const surface = resolveLeafSurface(node);
    if (!isRoot && TRACE_SURFACE_RE.test(surface)) {
      return null;
    }
    return {
      label: node.label,
      id: node.id,
      word: node.word
    };
  }

  return {
    label: node.label,
    id: node.id,
    children: prunedChildren
  };
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
  const base = ensureExplanationTerminator(removeWeakHedging(explanation));
  const hasMovementEvents = Array.isArray(movementEvents) && movementEvents.length > 0;

  const movementKinds = extractMovementEventKinds(movementEvents);
  const compatible = dedupeMovementSentences(
    splitExplanationSentences(base)
      .filter((sentence) => isCompatibleMovementSentence(sentence, movementKinds))
  ).join(' ');
  const compatibleText = ensureExplanationTerminator(compatible);

  if (hasMovementEvents) {
    const summary = buildSupplementalMovementSummary(compatibleText, tree, movementEvents);
    if (!compatibleText) return summary || summarizeMovementFromEvents(tree, movementEvents);
    if (!summary) return compatibleText;
    return `${compatibleText} ${summary}`.trim();
  }

  if (compatibleText) return compatibleText;
  return 'No movement is posited in this analysis.';
};

const ensureReplaySpelloutStep = (parse: ParseResult | null): DerivationStep[] | undefined => {
  if (!parse) return undefined;
  const existing = Array.isArray(parse.derivationSteps) ? parse.derivationSteps : [];
  const surfaceOrder = Array.isArray(parse.surfaceOrder)
    ? parse.surfaceOrder.map((token) => String(token || '').trim()).filter(Boolean)
    : [];
  if (surfaceOrder.length === 0) return existing.length > 0 ? existing : undefined;
  const hasSpellout = existing.some((step) => String(step?.operation || '').trim() === 'SpellOut');
  if (hasSpellout) return existing;

  const rootId = String(parse.tree?.id || '').trim() || undefined;
  const rootLabel = String(parse.tree?.label || '').trim() || 'Tree';
  return [
    ...existing,
    {
      operation: 'SpellOut',
      targetNodeId: rootId,
      targetLabel: rootLabel,
      sourceNodeIds: rootId ? [rootId] : undefined,
      sourceLabels: [rootLabel],
      recipe: 'SpellOut',
      workspaceAfter: [rootLabel],
      spelloutOrder: surfaceOrder,
      note: 'Final spellout of the committed surface order.'
    }
  ];
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
  const [needsKey, setNeedsKey] = useState(false);
  const [abstractionMode, setAbstractionMode] = useState(false);
  const [framework, setFramework] = useState<'xbar' | 'minimalism'>('xbar');
  const [modelRoute, setModelRoute] = useState<ModelRoute>('flash-lite');
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
  const selectedModelLabel = modelRoute === 'pro' ? 'Gemini 3.1 Pro' : 'Gemini 3.1 Flash Lite';
  const modelLabel = formatModelLabel(analysisBundle?.modelUsed);
  const isFallbackModel = Boolean(analysisBundle?.fallbackUsed);
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  const resolvedMovementLinks = useMemo(() => {
    if (!activeParse) return [];
    return resolveMovementEventLinks(activeParse.tree, activeParse.movementEvents, framework);
  }, [activeParse, framework]);
  const growthMovementMaps = useMemo(() => {
    if (!activeParse) return EMPTY_MOVEMENT_INDEX_MAPS;
    return buildMovementIndexMaps(activeParse.tree, activeParse.movementEvents, framework);
  }, [activeParse, framework]);
  const replayDerivationSteps = useMemo(() => ensureReplaySpelloutStep(activeParse), [activeParse]);
  const canopyMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    const tracePrunedTree = pruneCanopyMovementArtifacts(activeParse.tree) || activeParse.tree;
    return buildMilesNotation(tracePrunedTree, 'canopy');
  }, [activeParse]);
  const growthMilesNotation = useMemo(() => {
    if (!activeParse) return '';
    return buildMilesNotation(activeParse.tree, 'growth', activeParse.movementEvents, growthMovementMaps);
  }, [activeParse, growthMovementMaps]);
  const normalizedExplanation = useMemo(() => {
    if (!activeParse) return '';
    return normalizeExplanationForDisplay(activeParse.explanation, activeParse.movementEvents, activeParse.tree);
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
      const data = await parseSentence(input, framework, modelRoute);
      setAnalysisBundle(data);
      setModelRoute(data.requestedModelRoute || modelRoute);
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
    setModelRoute(entry.bundle.requestedModelRoute || inferModelRouteFromModel(entry.bundle.modelUsed));
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
              <div className="flex flex-wrap items-center justify-start md:justify-between gap-2 md:gap-4">
                <div className="flex flex-wrap items-center gap-2 md:gap-3">
                  {!isTreeBankView ? (
                    <>
                      <button
                        onClick={() => setFramework(framework === 'xbar' ? 'minimalism' : 'xbar')}
                        className={`flex items-center gap-2 md:gap-2.5 min-w-[19.5rem] justify-center px-3.5 md:px-4 py-2 rounded-xl border transition-all text-[9px] font-black uppercase tracking-[0.18em] md:tracking-widest shadow-inner group whitespace-nowrap ${
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

                <div className="flex flex-wrap items-center gap-2 md:gap-4">
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
                    <button
                      onClick={() => setModelRoute(modelRoute === 'flash-lite' ? 'pro' : 'flash-lite')}
                      className={`flex items-center gap-2 text-[9px] font-black px-3.5 md:px-5 py-2 md:py-2.5 rounded-full border tracking-[0.18em] md:tracking-widest uppercase shadow-inner whitespace-nowrap ${
                        modelRoute === 'pro'
                          ? 'text-purple-300 bg-purple-950/35 border-purple-700/40'
                          : 'text-emerald-400 bg-emerald-950/40 border-emerald-900/30'
                      }`}
                      title={
                        analysisBundle?.modelUsed
                          ? `Selected route: ${selectedModelLabel}. Last parse used: ${modelLabel}${isFallbackModel ? ' (fallback).' : '.'}`
                          : 'Toggle parsing model route'
                      }
                    >
                      <Zap size={10} className={modelRoute === 'pro' ? 'fill-purple-300' : 'fill-emerald-400'} />
                      {selectedModelLabel}
                    </button>
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
              resolvedMovementLinks={resolvedMovementLinks}
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
                      {activeParse.interpretation && (
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400/70 mb-4">{activeParse.interpretation}</p>
                      )}
                      <p className="text-emerald-50/90 leading-relaxed italic serif text-lg md:text-2xl border-l-2 border-emerald-500/20 pl-5 md:pl-8">"{normalizedExplanation}"</p>
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

            {!hideShowcaseInput && (
              <>
                {/* Input UI */}
                <div
                  className={`absolute left-1/2 -translate-x-1/2 z-30 w-full max-w-3xl px-4 md:px-8 transition-all duration-700 ${isInputVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-10 pointer-events-none'}`}
                  style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className={`glass-dark rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.8)] transition-all duration-700 overflow-hidden`}>
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

                    <div className={`transition-all duration-700 ease-in-out ${isInputExpanded ? 'max-h-[350px] opacity-100 p-4 md:p-6 pt-3 md:pt-4' : 'max-h-0 opacity-0'}`}>
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
