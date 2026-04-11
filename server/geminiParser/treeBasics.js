export const FORBIDDEN_STRING_LEAF_TOKENS = new Set([
  'id',
  'label',
  'word',
  'children',
  'tree',
  'analysis',
  'analyses',
  'explanation'
]);

export const STRUCTURAL_LEAF_LABELS = new Set([
  'c', "c'", 'cp',
  'i', 'infl', "infl'", 'inflp', 'ip',
  't', "t'", 'tp',
  'v', "v'", 'vp',
  'd', "d'", 'dp', 'det', 'pron',
  'n', "n'", 'np',
  'p', "p'", 'pp',
  'a', "a'", 'ap', 'adj',
  'adv', "adv'", 'advp',
  'q', "q'", 'qp',
  'speccp', 'spectp', 'specinflp', 'specip',
  'top', "top'", 'topp',
  'focus', "focus'", 'focusp',
  'neg', "neg'", 'negp',
  'wh', 'aux'
]);

export const PRIME_CATEGORY_LABEL_RE = /^[A-Za-z][A-Za-z0-9]*[’']$/;
export const PRIME_MARK_RE = /[’']/g;

const NULL_SYMBOL_LABEL = /^(?:∅|Ø|ε|null|epsilon)(?:[_-][a-z0-9]+)*$/i;
const PRO_LIKE_SURFACE_RE = /^(?:pro)(?:[_-][a-z0-9]+)*$/i;

export const nextGeneratedNodeId = (usedIds, counterRef) => {
  let candidate = `n${counterRef.value}`;
  while (usedIds.has(candidate)) {
    counterRef.value += 1;
    candidate = `n${counterRef.value}`;
  }
  usedIds.add(candidate);
  counterRef.value += 1;
  return candidate;
};

export const canonicalizeCovertSurface = (surface) => {
  const raw = String(surface || '').trim();
  if (!raw) return raw;
  if (PRO_LIKE_SURFACE_RE.test(raw)) return 'PRO';
  if (NULL_SYMBOL_LABEL.test(raw)) return '∅';
  return raw;
};

const normalizeCategoryKey = (label) => String(label || '').trim().replace(/['′\s]/g, '').toUpperCase();

const inferHeadFromPrimeLabel = (label) => {
  const trimmed = String(label || '').trim();
  const match = trimmed.match(/^(.+?)['′]+$/);
  if (!match?.[1]) return null;
  return match[1].trim() || null;
};

export const canonicalizeBareNullHeadChildren = (parentLabel, children, usedIds, counterRef) => {
  if (!Array.isArray(children) || children.length === 0) return children;
  const headLabel = inferHeadFromPrimeLabel(parentLabel);
  if (!headLabel) return children;

  const headKey = normalizeCategoryKey(headLabel);
  const hasExplicitHeadChild = children.some((child) => normalizeCategoryKey(child?.label) === headKey);
  if (hasExplicitHeadChild) return children;

  return children.map((child) => {
    const childChildren = Array.isArray(child?.children) ? child.children : [];
    if (childChildren.length > 0) return child;

    const childLabel = String(child?.label || '').trim();
    const childWord = typeof child?.word === 'string' ? child.word.trim() : '';
    const surface = canonicalizeCovertSurface(childWord || childLabel);
    if (!NULL_SYMBOL_LABEL.test(surface)) return child;

    return {
      id: nextGeneratedNodeId(usedIds, counterRef),
      label: headLabel,
      children: [child]
    };
  });
};

export const collectNodeReferencesById = (value) => {
  const references = new Map();
  const seen = new Set();

  const walk = (current) => {
    if (!current || typeof current !== 'object') return;
    if (seen.has(current)) return;
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }

    const id = typeof current.id === 'string' ? current.id.trim() : '';
    const label = typeof current.label === 'string' ? current.label.trim() : '';
    if (id && label && !references.has(id)) {
      references.set(id, current);
    }

    Object.values(current).forEach(walk);
  };

  walk(value);
  return references;
};

export const normalizeLabelForFramework = (rawLabel, framework) => {
  let label = String(rawLabel || '').trim();
  label = label.replace(/^([A-Za-z]+)_bar$/i, "$1'");
  if (framework !== 'minimalism') return label;
  if (!PRIME_CATEGORY_LABEL_RE.test(label)) return label;
  return label.slice(0, -1);
};

export const normalizeSurfaceSpan = (value) => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return undefined;
  return [start, end];
};

export const normalizeTokenIndex = (value, sentenceLength) => {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return undefined;
  if (Number.isFinite(sentenceLength) && numeric >= sentenceLength) return undefined;
  return numeric;
};

export const normalizeSingletonTokenHint = (value, sentenceLength) => {
  if (Array.isArray(value) && value.length === 1) {
    return normalizeTokenIndex(value[0], sentenceLength);
  }
  return normalizeTokenIndex(value, sentenceLength);
};

export const normalizeOptionalMetadataText = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export const normalizeOptionalMetadataBoolean = (value) =>
  typeof value === 'boolean' ? value : undefined;

export const normalizeExplicitSurfaceWord = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const candidateKeys = [
    'word',
    'surfaceWord',
    'surface',
    'text',
    'overtWord',
    'pronunciation',
    'pronouncedWord',
    'token'
  ];
  for (const key of candidateKeys) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return value[key].trim();
    }
  }
  return '';
};

export const parseIndexedSurfaceLeaf = (value, sentenceLength) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const bracketMatch = trimmed.match(/^(.+?)\[(\d+)\]$/);
  if (bracketMatch) {
    const boundedSentenceLength = Number.isFinite(sentenceLength) ? sentenceLength : Number.POSITIVE_INFINITY;
    const tokenIndex = normalizeTokenIndex(bracketMatch[2], boundedSentenceLength);
    if (tokenIndex === undefined) return null;

    const word = bracketMatch[1].trim();
    if (!word) return null;
    return { word, tokenIndex };
  }

  const prefixedMatch = trimmed.match(/^(\d+):(.+)$/);
  if (!prefixedMatch) return null;

  const boundedSentenceLength = Number.isFinite(sentenceLength) ? sentenceLength : Number.POSITIVE_INFINITY;
  const tokenIndex = normalizeTokenIndex(prefixedMatch[1], boundedSentenceLength);
  if (tokenIndex === undefined) return null;

  const word = prefixedMatch[2].trim();
  if (!word) return null;
  return { word, tokenIndex };
};

export const looksLikeSyntaxNodeObject = (value) => (
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && (
    typeof value.label === 'string'
    || typeof value.word === 'string'
    || Array.isArray(value.children)
    || !!normalizeExplicitSurfaceWord(value)
  )
);

export const getLabelProfile = (label) => {
  const raw = String(label || '').trim();
  const normalized = raw.replace(PRIME_MARK_RE, "'");
  const lowercase = normalized.toLowerCase();
  const isPrime = /'$/.test(normalized);
  const isPhrasal = /p$/i.test(normalized) || isPrime;
  const base = lowercase.replace(/p$/i, '').replace(/'$/g, '');
  const isHeadLikeStructural = !isPhrasal;

  return {
    raw,
    normalized,
    lowercase,
    base,
    isPrime,
    isPhrasal,
    isHeadLikeStructural
  };
};
