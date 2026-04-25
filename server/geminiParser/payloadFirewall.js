const TRANSCRIBER_GATE_STRING_KEYS = [
  'id',
  'frameId',
  'stepId',
  'chainId',
  'factId',
  'noteId',
  'fromNodeId',
  'landingNodeId',
  'hostNodeId',
  'toNodeId',
  'traceNodeId',
  'sourceNodeId',
  'targetNodeId',
  'selectorNodeId',
  'selectedNodeId',
  'nodeId',
  'operation',
  'kind',
  'label'
];

const decodeJsonLikeString = (value) => {
  if (typeof value !== 'string') return '';
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
};

export const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeOptionalString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || '';
};

const firstPresentValue = (...values) => values.find((value) => {
  if (typeof value === 'string') return normalizeOptionalString(value);
  return value !== undefined && value !== null;
});

const looksLikeMovementEvent = (value) => Boolean(
  value
  && typeof value === 'object'
  && (
    value.fromNodeId !== undefined
    || value.landingNodeId !== undefined
    || value.hostNodeId !== undefined
    || value.toNodeId !== undefined
    || value.source !== undefined
    || value.target !== undefined
    || value.sourceNodeId !== undefined
    || value.targetNodeId !== undefined
    || value.trace !== undefined
    || value.traceNodeId !== undefined
  )
);

const looksLikeNoteBinding = (value) => Boolean(
  value
  && typeof value === 'object'
  && (
    value.noteId !== undefined
    || value.noteType !== undefined
    || value.category !== undefined
    || value.chainIds !== undefined
    || value.supportIds !== undefined
    || value.text !== undefined
    || value.explanation !== undefined
    || value.content !== undefined
    || value.note !== undefined
  )
);

const canonicalizeMovementEventForGate = (value) => {
  const canonical = {};
  Object.keys(value).forEach((key) => {
    if (['type', 'source', 'sourceNodeId', 'target', 'targetNodeId', 'landingNodeId', 'hostNodeId', 'trace'].includes(key)) return;
    canonical[key] = canonicalizeTransportValueForGate(value[key]);
  });

  const operation = normalizeOptionalString(firstPresentValue(value.operation, value.type));
  const fromNodeId = normalizeOptionalString(firstPresentValue(value.fromNodeId, value.sourceNodeId, value.source));
  const landingNodeId = normalizeOptionalString(firstPresentValue(value.landingNodeId, value.toNodeId, value.targetNodeId, value.target));
  const hostNodeId = normalizeOptionalString(firstPresentValue(value.hostNodeId, value.host));
  const traceNodeId = normalizeOptionalString(firstPresentValue(value.traceNodeId, value.trace));

  if (operation) canonical.operation = operation;
  if (fromNodeId) canonical.fromNodeId = fromNodeId;
  if (landingNodeId) {
    canonical.landingNodeId = landingNodeId;
    canonical.toNodeId = landingNodeId;
  }
  if (hostNodeId) canonical.hostNodeId = hostNodeId;
  if (traceNodeId) canonical.traceNodeId = traceNodeId;

  return canonical;
};

const canonicalizeNoteBindingForGate = (value) => {
  const canonical = {};
  Object.keys(value).forEach((key) => {
    if (['id', 'noteType', 'category', 'chainIds', 'explanation', 'content', 'note'].includes(key)) return;
    canonical[key] = canonicalizeTransportValueForGate(value[key]);
  });

  const noteId = normalizeOptionalString(firstPresentValue(value.noteId, value.id));
  const kind = normalizeOptionalString(firstPresentValue(value.kind, value.noteType, value.category));
  const text = normalizeOptionalString(firstPresentValue(value.text, value.explanation, value.content, value.note));
  const chainId = normalizeOptionalString(firstPresentValue(
    value.chainId,
    Array.isArray(value.chainIds) ? value.chainIds[0] : undefined
  ));

  if (noteId) canonical.noteId = noteId;
  if (kind) canonical.kind = kind;
  if (text) canonical.text = text;
  if (chainId) canonical.chainId = chainId;

  return canonical;
};

export const canonicalizeTransportValueForGate = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeTransportValueForGate(item));
  }
  if (!value || typeof value !== 'object') return value;

  if (looksLikeMovementEvent(value)) {
    return canonicalizeMovementEventForGate(value);
  }
  if (looksLikeNoteBinding(value)) {
    return canonicalizeNoteBindingForGate(value);
  }

  const canonical = {};
  Object.keys(value).forEach((key) => {
    canonical[key] = canonicalizeTransportValueForGate(value[key]);
  });
  return canonical;
};

export const buildPayloadFingerprint = (payload) =>
  stableStringify(canonicalizeTransportValueForGate(payload));

const DERIVATION_STAGE_RELOCATABLE_FIELDS = ['statement', 'stageRecord', 'visualRelations'];

const cloneTransportValue = (value) => (
  value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : value
);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const relocateLeakedDerivationStageFieldsForGate = (payload) => {
  const cloned = cloneTransportValue(payload);
  const analyses = Array.isArray(cloned?.analyses) ? cloned.analyses : [];

  analyses.forEach((analysis) => {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return;
    const stages = Array.isArray(analysis.derivationStages) ? analysis.derivationStages : [];
    if (stages.length === 0) return;

    const leakedFields = DERIVATION_STAGE_RELOCATABLE_FIELDS
      .filter((field) => hasOwn(analysis, field));
    if (leakedFields.length === 0) return;

    const targetFields = leakedFields.filter((field) => field !== 'visualRelations');
    const fieldsThatIdentifyTarget = targetFields.length > 0 ? targetFields : leakedFields;
    const targetIndexes = new Set();
    fieldsThatIdentifyTarget.forEach((field) => {
      stages.forEach((stage, index) => {
        if (stage && typeof stage === 'object' && !Array.isArray(stage) && !hasOwn(stage, field)) {
          targetIndexes.add(index);
        }
      });
    });

    if (targetIndexes.size !== 1) return;
    const [targetIndex] = Array.from(targetIndexes);
    const targetStage = stages[targetIndex];
    if (!targetStage || typeof targetStage !== 'object' || Array.isArray(targetStage)) return;

    leakedFields.forEach((field) => {
      if (!hasOwn(targetStage, field)) {
        targetStage[field] = analysis[field];
      }
      delete analysis[field];
    });
  });

  return cloned;
};

export const buildPayloadFingerprintAllowingStageFieldRelocation = (payload) =>
  stableStringify(canonicalizeTransportValueForGate(
    relocateLeakedDerivationStageFieldsForGate(payload)
  ));

export const extractRawStructuralAnchors = (rawText) => {
  const text = String(rawText || '');
  const anchors = Object.fromEntries(
    TRANSCRIBER_GATE_STRING_KEYS.map((key) => [key, new Set()])
  );

  for (const key of TRANSCRIBER_GATE_STRING_KEYS) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
    let match = pattern.exec(text);
    while (match) {
      const decoded = decodeJsonLikeString(match[1]).trim();
      if (decoded) anchors[key].add(decoded);
      match = pattern.exec(text);
    }
  }

  return anchors;
};

export const collectPayloadStructuralAnchors = (value) => {
  const anchors = Object.fromEntries(
    TRANSCRIBER_GATE_STRING_KEYS.map((key) => [key, new Set()])
  );

  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== 'object') return;
    Object.entries(entry).forEach(([key, child]) => {
      if (TRANSCRIBER_GATE_STRING_KEYS.includes(key) && typeof child === 'string') {
        const normalized = child.trim();
        if (normalized) anchors[key].add(normalized);
      }
      visit(child);
    });
  };

  visit(value);
  return anchors;
};

export const payloadRespectsRawStructuralAnchors = (payload, rawText) => {
  const rawAnchors = extractRawStructuralAnchors(rawText);
  const transcribedAnchors = collectPayloadStructuralAnchors(payload);

  let rawSignalCount = 0;
  for (const key of TRANSCRIBER_GATE_STRING_KEYS) {
    rawSignalCount += rawAnchors[key].size;
  }
  if (rawSignalCount === 0) {
    return {
      ok: false,
      reason: 'no_raw_structural_anchors'
    };
  }

  for (const key of TRANSCRIBER_GATE_STRING_KEYS) {
    const allowed = rawAnchors[key];
    for (const value of transcribedAnchors[key]) {
      if (!allowed.has(value)) {
        return {
          ok: false,
          reason: 'transcriber_structural_drift',
          key,
          value
        };
      }
    }
  }

  return { ok: true };
};
