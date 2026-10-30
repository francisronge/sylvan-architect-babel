import type * as d3 from 'd3';
import { isWordlessLeaf } from '../server/babelParser/nodePronunciation.js';
import type { SyntaxNode } from '../types.ts';
import { categoryLabel as normalizeStructuralLabel } from './categoryLabel.ts';

/** Surface and index notation only; this does not infer movement or pronunciation. */
const PRIME_CATEGORY_LABEL_RE = /[′’'](?:\s*\[[^\[\]]*\])*$/u;

/* Text only: whether a written surface (a wordless leaf's label, "⟨T⟩") spells
 * a category name rather than a word or trace. A string has no shape, so this
 * keeps a short list of single-head category names. It never decides whether a
 * tree node is a head; structuralHeads.ts reads that from shape. */
const CATEGORY_NAME_SURFACE_RE = /^(?:C|Q|WH|T|INFL|I|V|D|N|A|P|AUX)$/i;

const isPhraseShellLabel = (label?: string): boolean => {
  const normalized = normalizeStructuralLabel(label);
  if (!normalized) return false;
  return /P$/i.test(normalized);
};

const isHeadCategorySurface = (label?: string): boolean => {
  const raw = String(label || '').trim();
  if (!raw || PRIME_CATEGORY_LABEL_RE.test(raw)) return false;
  const normalized = normalizeStructuralLabel(raw);
  if (!normalized) return false;
  return CATEGORY_NAME_SURFACE_RE.test(normalized);
};

export const isStructuralCategorySurface = (surface?: string): boolean => {
  const normalized = normalizeStructuralLabel(surface);
  if (!normalized) return false;
  return isHeadCategorySurface(normalized) || isPhraseShellLabel(normalized);
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't', 'ᵥ': 'v'
};
const DIGIT_TO_SUBSCRIPT: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉'
};
const INDEX_TO_SUBSCRIPT: Record<string, string> = Object.fromEntries(
  Object.entries(SUBSCRIPT_MAP).map(([subscript, plain]) => [plain, subscript])
);

export const isTraceLike = (label: string): boolean => {
  const text = label.trim();
  if (!text) return false;
  const sourceUnwrapped = text.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  const normalized = [...text].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const unwrapped = normalized.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  if (isStructuralCategorySurface(unwrapped) && unwrapped === unwrapped.toUpperCase()) {
    return false;
  }
  return (
    /^t\d*$/.test(unwrapped) ||
    /^t[ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜᵥ]+$/u.test(sourceUnwrapped) ||
    /^t(?:[_-](?:\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9]+\]|\([A-Za-z0-9]+\)))+$/.test(unwrapped) ||
    /^trace\b/i.test(unwrapped) ||
    /^copy$/i.test(unwrapped) ||
    /^<[^>]+>$/.test(normalized) ||
    /^⟨[^⟩]+⟩$/.test(normalized)
  );
};

/** Only a visible subscript proves notation is already present in painted text. */
export const extractDisplayedSubscriptIndex = (label: string): string | null => {
  const suffix = label.trim().match(/([₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜᵥ]+)$/)?.[1];
  return suffix ? [...suffix].map(ch => SUBSCRIPT_MAP[ch] || ch).join('').toLowerCase() : null;
};

export const extractMovementIndex = (label: string): string | null => {
  const text = [...label.trim()].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (braced?.[1]) return braced[1].toLowerCase();
  const plain = text.match(/_([A-Za-z0-9]+)$/);
  if (plain?.[1]) return plain[1].toLowerCase();
  const traceDigits = text.match(/^t(\d+)$/i);
  if (traceDigits?.[1]) return traceDigits[1];
  return extractDisplayedSubscriptIndex(label);
};

const toSubscriptDigits = (value: string): string =>
  value
    .split('')
    .map((ch) => DIGIT_TO_SUBSCRIPT[ch] || INDEX_TO_SUBSCRIPT[ch.toLowerCase()] || ch)
    .join('');

/** Every glyph the terminal formatter can append or substitute. */
export const REPLAY_GENERATED_TERMINAL_GLYPHS = [...new Set(`t∅${toSubscriptDigits('abcdefghijklmnopqrstuvwxyz0123456789')}`)].join('');

export const normalizeTraceIndexForDisplay = (index?: string | null): string => {
  const normalized = [...String(index || '').trim()]
    .map((ch) => SUBSCRIPT_MAP[ch] || ch)
    .join('')
    .toLowerCase();
  if (!normalized) return '';
  const numeric = /^\d+$/.test(normalized)
    ? Number(normalized)
    : NaN;
  if (Number.isFinite(numeric)) return numeric >= 1 ? String(numeric) : '';
  return /^[a-z]+$/.test(normalized) ? normalized : '';
};

export const buildTraceDisplayLabel = (index?: string | null): string => {
  const normalized = normalizeTraceIndexForDisplay(index);
  const suffix = /^\d+$/.test(normalized) ? normalized : '';
  return suffix ? `t${toSubscriptDigits(suffix)}` : 't';
};

export const formatIndexedSurfaceForDisplayValue = (
  surface: string,
  index?: string | null
): string => {
  if (extractMovementIndex(surface)) return surface;
  const suffix = normalizeTraceIndexForDisplay(index);
  return suffix ? `${surface}${toSubscriptDigits(suffix)}` : surface;
};

export const formatTraceSurfaceForDisplayValue = (
  surface: string,
  _fallbackIndex?: string | null
): string => {
  return surface;
};

const DISPLAY_TRACE_LABEL_RE = /^t(?:[₀₁₂₃₄₅₆₇₈₉]+)?$/;

/**
 * Witness notation belongs to the author. Derived chain identities still bind
 * arrows and lexical occurrence indices, but do not replace or renumber traces.
 */
export const formatAuthoredWitnessSurface = (
  surface: string,
  _inheritedTraceIndex?: string | null,
  _aliasedTraceIndex?: string | null
): string => {
  return surface;
};

export const isDisplayTraceLabel = (value?: string): boolean =>
  DISPLAY_TRACE_LABEL_RE.test(String(value || '').trim());

const NULL_LIKE_LABEL = /^(∅|Ø|ε|NULL|EPSILON)$/i;

export const isNullLike = (label: string): boolean => NULL_LIKE_LABEL.test(label.trim());

/**
 * A wordless leaf is an abstract category whatever its label spells, unless
 * the label is display notation for an unpronounced position (`t`, `∅`).
 */
export const isWordlessCategoryLeaf = (node: SyntaxNode): boolean =>
  isWordlessLeaf(node) && !isNotationSurface(node.label);

/** Match painted terminal material, including authored words that spell categories. */
export const isDisplayTerminalNode = (node: SyntaxNode): boolean =>
  !node.children?.length && !isWordlessCategoryLeaf(node);

export const resolveLeafSurface = (node: d3.HierarchyNode<SyntaxNode>): string => (node.data.word || node.data.label || '').trim();


/**
 * Pronunciation is decided by authored fields (nodePronunciation.js). The
 * helpers below add notation styling for unpronounced leaves and inherit
 * silence from current syntax, never from invisible future layout context.
 */
export const isNotationSurface = (surface?: string): boolean => {
  const trimmed = String(surface || '').trim();
  return Boolean(trimmed) && (isTraceLike(trimmed) || isNullLike(trimmed));
};


export const shouldExpandPreterminalLeaf = (node: SyntaxNode): boolean => {
  if (Array.isArray(node.children) && node.children.length > 0) return false;
  const label = String(node.label || '').trim();
  const word = typeof node.word === 'string' ? node.word.trim() : '';
  if (!label || !word) return false;
  if (isTraceLike(label)) return false;
  // Only a label that spells its word exactly is that word. Surface-token
  // matching strips notation such as √ and folds case; a category must keep
  // both, so the category I stands above its word i.
  return label !== word;
};
