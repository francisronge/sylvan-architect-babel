const normalizeParsedRoot = (value) => {
  if (Array.isArray(value)) return { analyses: value };
  if (value && typeof value === 'object') return value;
  return null;
};

const extractBalancedJsonRoot = (text) => {
  const source = String(text || '');
  let startIndex = -1;
  let openChar = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{' || char === '[') {
      startIndex = index;
      openChar = char;
      break;
    }
  }
  if (startIndex < 0) return null;

  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(startIndex, index + 1).trim();
        const leading = source.slice(0, startIndex).trim();
        const trailing = source.slice(index + 1).trim();
        return {
          candidate,
          leading,
          trailing,
          hadWrapperText: Boolean(leading || trailing)
        };
      }
    }
  }

  return null;
};

const parseStrictJsonCandidate = (candidate, createError, integrityFlags = []) => {
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }

  if (typeof parsed === 'string') {
    const nested = parsed.trim();
    if (nested.startsWith('{') || nested.startsWith('[')) {
      try {
        parsed = JSON.parse(nested);
        integrityFlags.push('json_string_unwrapped');
      } catch {
        throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
      }
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
    const embedded = parsed.text.trim();
    if (embedded.startsWith('{') || embedded.startsWith('[')) {
      try {
        parsed = JSON.parse(embedded);
        integrityFlags.push('json_text_field_unwrapped');
      } catch {
        throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
      }
    }
  }

  const normalized = normalizeParsedRoot(parsed);
  if (!normalized) {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  return normalized;
};

const looksLikeTruncatedJsonContinuation = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^[,}\]]/.test(text)) return true;
  if (/^[{[]/.test(text) && /"(?:analyses|derivationStages|statement|stageRecord|workspaceForest)"\s*:/.test(text)) return true;
  return /^"(?:analyses|derivationStages|statement|stageRecord|workspaceForest)"\s*:/.test(text);
};

const extractBalancedObjectAt = (sourceText, startIndex) => {
  const source = String(sourceText || '');
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          text: source.slice(startIndex, index + 1),
          endIndex: index + 1
        };
      }
    }
  }
  return null;
};

const extractFirstBalancedObject = (sourceText) => {
  const source = String(sourceText || '');
  const firstOpenIndex = source.indexOf('{');
  if (firstOpenIndex < 0) return null;
  const extracted = extractBalancedObjectAt(source, firstOpenIndex);
  if (!extracted) return null;
  return {
    text: extracted.text,
    trailing: source.slice(extracted.endIndex)
  };
};

const isDerivationStageObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof value.statement === 'string'
  && typeof value.stageRecord === 'string'
  && Array.isArray(value.workspaceForest)
);

const extractTrailingDerivationStageObjects = (sourceText) => {
  const source = String(sourceText || '');
  const stages = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /[\s,]/.test(source[index])) index += 1;
    if (index >= source.length) break;
    if (/[\]}]/.test(source[index])) {
      let cursor = index;
      while (cursor < source.length && /[\]}]/.test(source[cursor])) cursor += 1;
      const afterPrematureClosers = source.slice(cursor).trimStart();
      if (afterPrematureClosers.startsWith(',')) {
        index = cursor;
        continue;
      }
      const rest = source.slice(index).trim();
      return /^[\]}]+$/.test(rest) ? stages : [];
    }
    if (source[index] !== '{') return [];
    const extracted = extractBalancedObjectAt(source, index);
    if (!extracted) return [];
    let parsedStage;
    try {
      parsedStage = JSON.parse(extracted.text);
    } catch {
      return [];
    }
    if (!isDerivationStageObject(parsedStage)) return [];
    stages.push(parsedStage);
    index = extracted.endIndex;
  }
  return stages;
};

const repairPrematureDerivationStageArrayClosure = (sourceText) => {
  const extracted = extractFirstBalancedObject(sourceText);
  if (!extracted || !looksLikeTruncatedJsonContinuation(extracted.trailing)) {
    return { text: String(sourceText || ''), changed: false };
  }

  let root;
  try {
    root = JSON.parse(extracted.text);
  } catch {
    return { text: String(sourceText || ''), changed: false };
  }

  const firstAnalysis = Array.isArray(root?.analyses) ? root.analyses[0] : null;
  const stages = Array.isArray(firstAnalysis?.derivationStages) ? firstAnalysis.derivationStages : null;
  if (!stages) {
    return { text: String(sourceText || ''), changed: false };
  }

  const trailingStages = extractTrailingDerivationStageObjects(extracted.trailing);
  if (trailingStages.length === 0) {
    return { text: String(sourceText || ''), changed: false };
  }

  firstAnalysis.derivationStages = [
    ...stages,
    ...trailingStages
  ];
  return {
    text: JSON.stringify(root),
    changed: true
  };
};

export const parseStrictModelJsonDetailed = (rawText, createError) => {
  const text = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!text) {
    throw createError('BAD_MODEL_RESPONSE', 'Model returned malformed JSON.', 502);
  }
  const integrityFlags = [];
  try {
    return {
      payload: parseStrictJsonCandidate(text, createError, integrityFlags),
      integrityFlags: Array.from(new Set(integrityFlags))
    };
  } catch (error) {
    const extracted = extractBalancedJsonRoot(text);
    if (!extracted?.candidate || extracted.candidate === text) {
      throw error;
    }
    if (looksLikeTruncatedJsonContinuation(extracted.trailing)) {
      const repaired = repairPrematureDerivationStageArrayClosure(text);
      if (repaired.changed) {
        integrityFlags.push('premature_derivation_stage_array_closure_repaired');
        return {
          payload: parseStrictJsonCandidate(repaired.text, createError, integrityFlags),
          integrityFlags: Array.from(new Set(integrityFlags))
        };
      }
      throw error;
    }
    if (extracted.hadWrapperText) {
      integrityFlags.push('json_root_extracted');
    }
    return {
      payload: parseStrictJsonCandidate(extracted.candidate, createError, integrityFlags),
      integrityFlags: Array.from(new Set(integrityFlags))
    };
  }
};

export const parseStrictModelJson = (rawText, createError) =>
  parseStrictModelJsonDetailed(rawText, createError).payload;
