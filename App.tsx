import React, { useState, useMemo, useEffect, useRef } from 'react';
import { parseSentence } from './services/geminiService';
import { DerivationStage, DerivationStep, ParseBundle, ParseResult, ReplayLedgerBlock, SyntaxNode } from './types';
import TreeVisualizer from './components/TreeVisualizer';
import RootLogo from './components/RootLogo';
import {
  stringifyLedgerAtom,
  normalizeLedgerDisplay,
  humanizeLedgerFallbackId
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

type AppTab = 'tree' | 'derivation' | 'notes';

const NAV_TABS: Array<{ id: AppTab; icon: React.ComponentType<{ size?: number }>; label: string }> = [
  { id: 'tree', icon: Layers, label: 'Canopy' },
  { id: 'derivation', icon: FlameKindling, label: 'Derivation Replay' },
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
    message: message || 'Derivation interrupted.'
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

const MODEL_MODE_SEQUENCE: ModelMode[] = ['local', 'pro', 'gpt-5.4', 'claude-4.6'];

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

const unwrapDevBundlePayload = (value: unknown): ParseBundle | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const response = candidate.response;
  if (response && typeof response === 'object' && Array.isArray((response as ParseBundle).analyses)) {
    return response as ParseBundle;
  }
  const result = candidate.result;
  if (result && typeof result === 'object' && Array.isArray((result as ParseBundle).analyses)) {
    return result as ParseBundle;
  }
  return Array.isArray((candidate as ParseBundle).analyses) ? candidate as ParseBundle : null;
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

const NULL_SURFACE_RE = /^(âˆ…|Ã˜|Îµ|null|epsilon)$/i;
const TRACE_SURFACE_RE = /^(?:t|trace|t\d+|trace\d+|t[_-][a-z0-9{}]+|trace[_-][a-z0-9{}]+|<[^>]+>|âŸ¨[^âŸ©]+âŸ©|\(t\)|\{t\})$/i;
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
    .replace(/â€™/g, "'")
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

const buildDerivationalNoteParagraphs = (
  stages: DerivationStage[] | undefined,
  fallbackExplanation: string
): string[] => {
  const stageParagraphs = (Array.isArray(stages) ? stages : [])
    .map((stage) => ensureExplanationTerminator(String(stage?.stageRecord || '')))
    .filter(Boolean);

  if (stageParagraphs.length > 0) return stageParagraphs;

  const fallback = ensureExplanationTerminator(String(fallbackExplanation || ''));
  return [fallback || 'No explanation provided.'];
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
    /"(?:analyses|analysis|derivationStages|stageRecord|visualRelations|workspaceForest|noteBindings|tree)"/.test(text)
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
    /^(?:analysis of[^:]*:\s*|deep dive into[^:]*:?|okay[, ]+|here(?:'|â€™)s how i(?:'|â€™)m thinking(?: about this sentence)?[, ]*|my immediate thought\??|first[, ]+|let(?:'|â€™)s\s+)/i;
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
    /"(?:analyses|analysis|derivationStages|stageRecord|visualRelations|workspaceForest|noteBindings|tree)"/.test(text)
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

const getPreferredDerivationSteps = (parse: ParseResult | null): DerivationStep[] => {
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
    .replace(/^âŸ¨|âŸ©$/g, '')
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
      if (/^(âˆ…|Ã˜|Îµ|null|epsilon)$/i.test(surface)) return [];
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

const COMMITMENT_FACT_HIDDEN_FIELDS = new Set([
  'factId',
  'kind',
  'family',
  'frameworkLabel',
  'kindValue',
  'chainId',
  'stepIds',
  'nodeIds'
]);

const humanizeOpenOntologyLabel = (value?: string): string => {
  const raw = stringifyLedgerAtom(value);
  if (!raw) return 'Derivational Record';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
};

const formatCommitmentFactFieldLabel = (key: string): string =>
  key
    .replace(/Ids?$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const formatCommitmentParticipant = (participant: Record<string, unknown>): string => {
  const role = stringifyLedgerAtom(participant.role);
  const label = stringifyLedgerAtom(participant.label);
  const value = stringifyLedgerAtom(participant.value);
  const nodeId = stringifyLedgerAtom(participant.nodeId);
  const referent = label || value || nodeId;
  if (!referent) return '';
  return role ? `${formatCommitmentFactFieldLabel(role)}: ${referent}` : referent;
};

const collectCommitmentFactFieldLines = (
  entry: Record<string, unknown>,
  resolveReadableReference: (preferred?: string, fallbackNodeRef?: string, options?: { structural?: boolean }) => string
): string[] => {
  const consumed = new Set<string>();
  const lines: string[] = [];
  const pushLine = (label: string, value: string) => {
    const cleanedValue = stringifyLedgerAtom(value);
    if (!cleanedValue) return;
    lines.push(`${label}: ${cleanedValue}`);
  };

  if (Array.isArray(entry.participants)) {
    const participants = entry.participants
      .map((participant) => formatCommitmentParticipant(participant as Record<string, unknown>))
      .filter(Boolean);
    if (participants.length > 0) {
      pushLine('Participants', participants.join('; '));
    }
    consumed.add('participants');
  }

  Object.entries(entry).forEach(([key, rawValue]) => {
    if (consumed.has(key) || COMMITMENT_FACT_HIDDEN_FIELDS.has(key)) return;
    if (key.endsWith('Id') || key.endsWith('Ids')) return;
    if (rawValue === undefined || rawValue === null) return;

    if (key.endsWith('Label')) {
      const labelValue = stringifyLedgerAtom(rawValue);
      if (!labelValue) return;
      const nodeIdKey = `${key.slice(0, -5)}NodeId`;
      const resolvedValue = resolveReadableReference(
        labelValue,
        stringifyLedgerAtom(entry[nodeIdKey]),
        { structural: true }
      ) || labelValue;
      pushLine(formatCommitmentFactFieldLabel(key), resolvedValue);
      consumed.add(key);
      consumed.add(nodeIdKey);
      return;
    }

    if (Array.isArray(rawValue)) {
      const values = rawValue
        .map((item) => stringifyLedgerAtom(item))
        .filter(Boolean);
      if (values.length === 0) return;
      pushLine(
        formatCommitmentFactFieldLabel(key),
        key === 'order' ? values.join(' > ') : values.join(', ')
      );
      return;
    }

    if (typeof rawValue === 'boolean') {
      pushLine(formatCommitmentFactFieldLabel(key), rawValue ? 'Yes' : 'No');
      return;
    }

    if (typeof rawValue === 'number') {
      pushLine(formatCommitmentFactFieldLabel(key), String(rawValue));
      return;
    }

    if (typeof rawValue === 'string') {
      const text = stringifyLedgerAtom(rawValue);
      if (!text) return;
      pushLine(formatCommitmentFactFieldLabel(key), text);
    }
  });

  return lines;
};

const formatCommitmentFactReplayEntry = (
  entry: Record<string, unknown>,
  resolveReadableReference: (preferred?: string, fallbackNodeRef?: string, options?: { structural?: boolean }) => string
): string => {
  const family = humanizeOpenOntologyLabel(
    stringifyLedgerAtom(entry.frameworkLabel) || stringifyLedgerAtom(entry.family) || stringifyLedgerAtom(entry.kind)
  );
  const subtype = stringifyLedgerAtom(entry.subtype);
  const detailLines = collectCommitmentFactFieldLines(entry, resolveReadableReference)
    .filter((line) => !/^Subtype:/i.test(line));
  const summary = detailLines.slice(0, 3).join('; ');
  const title = subtype ? `${family} (${subtype})` : family;
  if (!summary) return title;
  return `${title}: ${summary}`;
};

const fallbackReadableReference = (preferred?: string, fallbackNodeRef?: string): string =>
  stringifyLedgerAtom(preferred) || stringifyLedgerAtom(fallbackNodeRef) || '';

const buildCommitmentFactSupportBadges = (entry: Record<string, unknown>): Array<{ label: string; value: string }> => {
  const badges = [
    { label: 'Fact', value: stringifyLedgerAtom(entry.factId) },
    { label: 'Chain', value: stringifyLedgerAtom(entry.chainId) },
    {
      label: 'Steps',
      value: Array.isArray(entry.stepIds)
        ? entry.stepIds.map((stepId) => stringifyLedgerAtom(stepId)).filter(Boolean).join(', ')
        : ''
    },
    {
      label: 'Nodes',
      value: Array.isArray(entry.nodeIds)
        ? entry.nodeIds.map((nodeId) => stringifyLedgerAtom(nodeId)).filter(Boolean).join(', ')
        : ''
    }
  ].filter((badge) => badge.value);
  return badges;
};

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

  appendAnchoredLedgerEntries(
    'Derivational Record',
    (parse.commitmentFacts || parse.commitmentGraph || []) as Array<{ stepIds?: string[] } & Record<string, unknown>>,
    (entry) => formatCommitmentFactReplayEntry(entry, resolveReadableReference)
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
  const existing = getPreferredDerivationSteps(parse);
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
  const activeModelOption = MODEL_MODE_PILLS.find((option) => option.id === modelRoute) || MODEL_MODE_PILLS[0];
  const nextModelOption = MODEL_MODE_PILLS[
    (MODEL_MODE_SEQUENCE.indexOf(activeModelOption.id) + 1 + MODEL_MODE_SEQUENCE.length) % MODEL_MODE_SEQUENCE.length
  ] || MODEL_MODE_PILLS[0];
  const isTreeBankView = workspaceView === 'treeBank';
  const hideShowcaseInput = showcaseMode && Boolean(activeParse);
  const replayDerivationSteps = useMemo(() => ensureReplaySpelloutStep(activeParse), [activeParse]);
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
    return buildDerivationalNoteParagraphs(activeParse.derivationStages, activeParse.explanation);
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
        const surfaceOrderSentence = Array.isArray(firstAnalysis?.surfaceOrder)
          ? firstAnalysis.surfaceOrder.map((token) => String(token || '').trim()).filter(Boolean).join(' ')
          : '';
        const nextSentence =
          String(requestRecord.sentence || savedRecord.sentence || bundle.sentence || '').trim()
          || surfaceOrderSentence
          || 'Sentence unavailable';
        const nextFramework = requestRecord.framework === 'minimalism'
          ? 'minimalism'
          : (requestRecord.framework === 'xbar' ? 'xbar' : firstAnalysis?.provenance?.framework === 'minimalism' ? 'minimalism' : 'xbar');
        const nextModelRoute =
          String(requestRecord.modelRoute || savedRecord.requestedRoute || bundle.requestedModelRoute || '').trim()
          || inferModelRouteFromModel(bundle.modelUsed);

        setAnalysisBundle(bundle);
        setParsedSentence(nextSentence);
        setInput(nextSentence);
        setFramework(nextFramework);
        setModelRoute(coerceModelRoute(nextModelRoute));
        setActiveParseIndex(0);
        setActiveTab(devBundleConfig.tab);
        setError(null);
        setCopiedCodeKey(null);
        setNeedsKey(false);
        setKeyPromptMode('none');
        setWorkspaceView('arboretum');
        setLoading(false);
        setDevCaptureMode(devBundleConfig.captureMode);
        setIsInputVisible(!(showcaseMode || devBundleConfig.captureMode));
        setIsInputExpanded(!(showcaseMode || devBundleConfig.captureMode));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err || 'Unknown error');
        setError(`Unable to load preview bundle: ${message}`);
      }
    };

    loadDevBundle();
    return () => {
      cancelled = true;
    };
  }, [devBundleConfig, showcaseMode]);

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
                          ? `Selected route: ${selectedModelLabel}. Last parse used: ${modelLabel}.`
                          : 'Choose parsing model route'
                      }
                    >
                      <button
                        onClick={() => {
                          setModelRoute(nextModelOption.id);
                          setError(null);
                          setNeedsKey(false);
                          setKeyPromptMode('none');
                        }}
                        className={`flex items-center gap-2 text-[9px] font-black px-3.5 md:px-4 py-2 rounded-full border tracking-[0.18em] md:tracking-widest uppercase shadow-inner whitespace-nowrap transition-all ${activeModelOption.activeClassName}`}
                        title={`Current route: ${MODEL_ROUTE_LABELS[activeModelOption.id]}. Click to switch to ${MODEL_ROUTE_LABELS[nextModelOption.id]}.`}
                      >
                        {activeModelOption.keyRequired ? <Key size={10} /> : <Zap size={10} className="fill-current" />}
                        {MODEL_ROUTE_LABELS[activeModelOption.id]}
                      </button>
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

          {!loading && activeParse && (activeTab === 'tree' || activeTab === 'derivation') ? (
            <TreeVisualizer 
              data={activeParse.tree} 
              animated={activeTab === 'derivation'}
              derivationSteps={replayDerivationSteps}
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
                      {providerReasoningSummary && (
                        <details className="mt-6 md:mt-8 bg-black/35 border border-emerald-500/10 rounded-[1.5rem] md:rounded-[2rem] p-5 md:p-7 shadow-inner">
                          <summary className="cursor-pointer list-none flex items-center gap-3">
                            <div className="w-9 h-9 rounded-2xl bg-white/5 border border-white/10 text-emerald-400 flex items-center justify-center">
                              <Brain size={18} />
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-emerald-400/80">Provider Reasoning Trace</span>
                          </summary>
                          <p className="mt-4 text-emerald-50/85 leading-relaxed serif text-base md:text-xl whitespace-pre-wrap">
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
                        </details>
                      )}
                  </div>

                  {((activeParse.commitmentFacts || activeParse.commitmentGraph || []).length > 0) && (
                    <div className="glass-dark p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl">
                      <div className="flex items-center gap-4 md:gap-5 mb-6 md:mb-8">
                        <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-2xl flex items-center justify-center text-emerald-400 border border-white/10">
                          <Layers size={24} />
                        </div>
                        <div>
                          <h2 className="text-xl md:text-3xl font-bold text-white serif tracking-tight">Derivational Records</h2>
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500/40">Compiled Analysis Layer</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                        {((activeParse.commitmentFacts || activeParse.commitmentGraph || []) as Array<Record<string, unknown>>).map((fact, index) => {
                          const familyLabel = humanizeOpenOntologyLabel(
                            stringifyLedgerAtom(fact.frameworkLabel) || stringifyLedgerAtom(fact.family) || stringifyLedgerAtom(fact.kind)
                          );
                          const subtype = stringifyLedgerAtom(fact.subtype);
                          const fieldLines = collectCommitmentFactFieldLines(fact, fallbackReadableReference);
                          const supportBadges = buildCommitmentFactSupportBadges(fact);
                          return (
                            <div
                              key={stringifyLedgerAtom(fact.factId) || `commitment-fact-${index}`}
                              className="rounded-[1.5rem] border border-white/10 bg-black/35 p-5 md:p-6 shadow-inner"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                                <div>
                                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-emerald-400/75">
                                    {familyLabel}
                                  </p>
                                  {subtype && (
                                    <p className="mt-2 text-sm md:text-base text-emerald-50/70 serif italic">
                                      {subtype}
                                    </p>
                                  )}
                                </div>
                                {stringifyLedgerAtom(fact.factId) && (
                                  <span className="px-3 py-1.5 rounded-full border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-[0.22em] text-white/55">
                                    {stringifyLedgerAtom(fact.factId)}
                                  </span>
                                )}
                              </div>
                              {fieldLines.length > 0 && (
                                <div className="space-y-2">
                                  {fieldLines.map((line, lineIndex) => (
                                    <p
                                      key={`${stringifyLedgerAtom(fact.factId) || index}-${lineIndex}`}
                                      className="text-emerald-50/85 leading-relaxed text-sm md:text-base"
                                    >
                                      {line}
                                    </p>
                                  ))}
                                </div>
                              )}
                              {supportBadges.length > 0 && (
                                <div className="mt-5 flex flex-wrap gap-2">
                                  {supportBadges.map((badge) => (
                                    <span
                                      key={`${stringifyLedgerAtom(fact.factId) || index}-${badge.label}`}
                                      className="px-3 py-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300/80"
                                    >
                                      {badge.label}: {badge.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
