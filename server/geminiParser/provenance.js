const PROVENANCE_PROMPT_TOKEN_KEYS = [
  'primaryPromptTokenCount',
  'notesSecondPassPromptTokenCount'
];

const PROVENANCE_OUTPUT_TOKEN_KEYS = [
  'primaryOutputTokenCount',
  'notesSecondPassOutputTokenCount'
];

const PROVENANCE_TOTAL_TOKEN_KEYS = [
  'primaryTotalTokenCount',
  'notesSecondPassTotalTokenCount'
];

const sumProvenanceTokenKeys = (provenance, keys) => {
  let total = 0;
  let found = false;
  for (const key of keys) {
    const value = Number(provenance?.[key] || 0);
    if (!Number.isFinite(value) || value <= 0) continue;
    total += value;
    found = true;
  }
  return found ? total : undefined;
};

export const attachAggregateParseTokenCounts = (provenance = {}) => {
  const parsePromptTokenCount = sumProvenanceTokenKeys(provenance, PROVENANCE_PROMPT_TOKEN_KEYS);
  const parseOutputTokenCount = sumProvenanceTokenKeys(provenance, PROVENANCE_OUTPUT_TOKEN_KEYS);
  const parseTotalTokenCount = sumProvenanceTokenKeys(provenance, PROVENANCE_TOTAL_TOKEN_KEYS);
  return {
    ...provenance,
    ...(parsePromptTokenCount ? { parsePromptTokenCount } : {}),
    ...(parseOutputTokenCount ? { parseOutputTokenCount } : {}),
    ...(parseTotalTokenCount ? { parseTotalTokenCount } : {})
  };
};
