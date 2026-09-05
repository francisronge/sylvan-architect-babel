import { STRUCTURAL_LEAF_LABELS, PRIME_CATEGORY_LABEL_RE, canonicalizeCovertSurface } from './treeBasics.js';

const TRACE_LIKE_SURFACE_RE = /^(?:t|trace|copy|t\d+|trace\d+|copy\d+|(?:t|trace|copy)(?:_[a-z0-9]+)+|[a-z]+_(?:trace|copy)(?:_[a-z0-9]+)*|<[^>]+>|⟨[^⟩]+⟩|\(t\)|\{t\}|\(copy\)|\{copy\})$/i;
const NULL_LIKE_SURFACE_RE = /^(?:∅|Ø|ε|null|epsilon|pro)(?:[_-][a-z0-9]+)*$/i;

const isStructuralLeafLabel = (label) => {
  const raw = String(label || '').trim();
  if (!raw || !STRUCTURAL_LEAF_LABELS.has(raw.toLowerCase())) return false;
  return raw === raw.toUpperCase()
    || /^[A-Z]/.test(raw)
    || PRIME_CATEGORY_LABEL_RE.test(raw);
};

const traceLikeNodeType = (node) => {
  const rawType = String(node?.type || '').trim().toLowerCase();
  if (
    rawType === 'trace'
    || rawType.includes('trace')
    || rawType === 'lower-copy'
    || rawType === 'lower_copy'
    || rawType === 'silent-copy'
    || rawType === 'silent_copy'
  ) {
    return rawType;
  }
  return '';
};

const normalizeTraceLikeSurface = (surface) => (
  String(surface || '')
    .trim()
    .replace(/\{([^}]*)\}/g, '$1')
);

const isTraceLikeSurface = (surface) => {
  const raw = String(surface || '').trim();
  if (!raw) return false;
  return TRACE_LIKE_SURFACE_RE.test(raw)
    || TRACE_LIKE_SURFACE_RE.test(normalizeTraceLikeSurface(raw));
};

const isNullLikeSurface = (surface) => (
  NULL_LIKE_SURFACE_RE.test(String(surface || '').trim())
);

export const resolveNodeSurface = (node) => {
  const word = String(node?.word || '').trim();
  const label = String(node?.label || '').trim();
  return canonicalizeCovertSurface(word || label);
};

export const isTraceLikeNode = (node) => (
  Boolean(traceLikeNodeType(node))
  || isTraceLikeSurface(resolveNodeSurface(node))
);

export const isNullLikeNode = (node) => (
  isNullLikeSurface(resolveNodeSurface(node))
);

export const resolveOvertLeafSurface = (node) => {
  if (node?.silentFeature === true || node?.silent === true || traceLikeNodeType(node)) {
    return '';
  }
  const word = String(node?.word || '').trim();
  if (word) return word;
  const children = Array.isArray(node?.children) ? node.children : [];
  if (children.length > 0) return '';
  const label = String(node?.label || '').trim();
  if (!label || isStructuralLeafLabel(label)) return '';
  return label;
};
