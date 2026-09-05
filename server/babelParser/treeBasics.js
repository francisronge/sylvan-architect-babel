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

export const canonicalizeCovertSurface = (surface) => {
  const raw = String(surface || '').trim();
  if (!raw) return raw;
  if (PRO_LIKE_SURFACE_RE.test(raw)) return 'PRO';
  if (NULL_SYMBOL_LABEL.test(raw)) return '∅';
  return raw;
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
    normalizeNodeAliasIds(current.aliasIds).forEach((aliasId) => {
      if (!references.has(aliasId)) {
        references.set(aliasId, current);
      }
    });

    Object.values(current).forEach(walk);
  };

  walk(value);
  return references;
};

export const normalizeSurfaceSpan = (value) => {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  if (value[0] === null || value[0] === undefined || value[1] === null || value[1] === undefined) {
    return undefined;
  }
  const start = Number(value[0]);
  const end = Number(value[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return undefined;
  return [start, end];
};

export const normalizeTokenIndex = (value, sentenceLength) => {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) return undefined;
  if (Number.isFinite(sentenceLength) && numeric >= sentenceLength) return undefined;
  return numeric;
};

export const normalizeOptionalMetadataText = (value) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

export const normalizeNodeAliasIds = (value) => (
  Array.isArray(value)
    ? Array.from(new Set(
        value
          .map((item) => normalizeOptionalMetadataText(item))
          .filter(Boolean)
      ))
    : []
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
