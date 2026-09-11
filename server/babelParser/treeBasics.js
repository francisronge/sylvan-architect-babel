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
