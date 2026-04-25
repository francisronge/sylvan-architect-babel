export const createNormalizationUtils = ({ MOVEMENT_INDEX_SUBSCRIPT_MAP }) => {
  const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const isABarLikeText = (value) => /^(?:a\s*(?:['’′]|-?\s*bar)(?:\s*-\s*|\s*)?(?:move(?:ment)?|chain)?|wh(?:\s*-\s*)?(?:move(?:ment)?|chain)?)$/i.test(String(value || '').trim());
  const isALikeText = (value) => /^(?:a(?:\s*-\s*|\s*)?(?:move(?:ment)?|chain)?)$/i.test(String(value || '').trim());
  const normalizeOpenOperationLabel = (value) => {
    const text = String(value || '').trim();
    return text || undefined;
  };

  const normalizeDerivationOperation = (value) => {
    if (isABarLikeText(value)) return 'AbarMove';
    if (isALikeText(value)) return 'A-Move';
    const key = normalizeKey(value);
    if (!key) return undefined;
    if (key === 'lexicalselect' || key === 'select' || key === 'lexicalitemselect') return 'LexicalSelect';
    if (key === 'externalmerge' || key === 'merge') return 'ExternalMerge';
    if (key === 'internalmerge' || key === 'internalmove') return 'InternalMerge';
    if (key === 'headmove' || key === 'headmovement') return 'HeadMove';
    if (key === 'amove' || key === 'amovement') return 'A-Move';
    if (key === 'abarmove' || key === 'abarmovement' || key === 'whmove') return 'AbarMove';
    if (key === 'project' || key === 'projection') return 'Project';
    if (key === 'label' || key === 'labelling' || key === 'labeling') return 'Label';
    if (key === 'move' || key === 'movement') return 'Move';
    if (key === 'agree') return 'Agree';
    if (key === 'spelloutdomain' || key === 'transferdomain' || key === 'phasetransfer') return 'SpellOutDomain';
    if (key === 'spellout' || key === 'spelloutphase') return 'SpellOut';
    if (key === 'other') return 'Other';
    return normalizeOpenOperationLabel(value);
  };

  const normalizeSpelloutOrder = (value) => {
    if (!Array.isArray(value)) return undefined;
    const tokens = value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
    return tokens.length > 0 ? tokens : undefined;
  };

  const normalizeOptionalStepText = (value) => {
    const text = String(value || '').trim();
    return text || undefined;
  };

  const normalizeOptionalStringArray = (value) => {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => normalizeOptionalStepText(item))
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  const normalizeNodeIdArray = (value, nodeIds) => {
    if (!Array.isArray(value)) return undefined;
    const ids = value
      .map((item) => String(item || '').trim())
      .filter((id) => id.length > 0 && nodeIds.has(id));
    return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
  };

  const normalizeMovementOperation = (value) => {
    if (isABarLikeText(value)) return 'AbarMove';
    if (isALikeText(value)) return 'A-Move';
    const key = normalizeKey(value);
    if (!key) return undefined;
    if (key === 'move' || key === 'movement') return 'Move';
    if (key === 'internalmerge' || key === 'internalmove') return 'InternalMerge';
    if (key === 'headmove' || key === 'headmovement') return 'HeadMove';
    if (key === 'amove' || key === 'amovement') return 'A-Move';
    if (key === 'abarmove' || key === 'abarmovement' || key === 'whmove') return 'AbarMove';
    if (key === 'other') return 'Other';
    return normalizeOpenOperationLabel(value);
  };

  const normalizeOpenChainType = (value) => {
    const text = String(value || '').trim();
    return text || undefined;
  };

  const normalizeIndexedText = (value) =>
    [...String(value || '').trim()].map((ch) => MOVEMENT_INDEX_SUBSCRIPT_MAP[ch] || ch).join('');

  const extractMovementIndex = (value) => {
    const text = normalizeIndexedText(value);
    if (!text) return null;
    const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
    if (braced?.[1]) return braced[1].toLowerCase();
    const bareBraced = text.match(/(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
    if (bareBraced?.[1]) return bareBraced[1].toLowerCase();
    const postBracket = text.match(/[\]\)\}]([a-z]\d?|\d{1,2})$/i);
    if (postBracket?.[1]) return postBracket[1].toLowerCase();
    const plain = text.match(/_([A-Za-z0-9]+)$/);
    if (plain?.[1]) return plain[1].toLowerCase();
    const danglingSubscript = text.match(/([A-Za-z0-9]+)$/);
    return danglingSubscript?.[1] && /[₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜ]/.test(String(value || ''))
      ? danglingSubscript[1].toLowerCase()
      : null;
  };

  const stripMovementIndex = (value) => {
    const text = normalizeIndexedText(value);
    if (!text) return '';
    return text
      .replace(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/, '')
      .replace(/(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/, '')
      .replace(/([\]\)\}])([a-z]\d?|\d{1,2})$/i, '$1')
      .replace(/_([A-Za-z0-9]+)$/, '')
      .trim();
  };

  const normalizeChainType = (value) => {
    if (isABarLikeText(value)) return 'A-bar';
    if (isALikeText(value)) return 'A';
    const key = normalizeKey(value);
    if (!key) return undefined;
    if (key === 'a' || key === 'amove' || key === 'amovement' || key === 'achain') return 'A';
    if (
      key === 'abar'
      || key === 'abarmove'
      || key === 'abarmovement'
      || key === 'abarchain'
      || key === 'wh'
      || key === 'whmovement'
    ) return 'A-bar';
    if (
      key === 'head'
      || key === 'headchain'
      || key === 'headmove'
      || key === 'headmovement'
      || key === 'lower'
      || key === 'lowering'
      || key === 'headlowering'
      || key === 'affixhop'
      || key === 'cliticclimbing'
      || key === 'cliticraising'
      || key === 'incorporation'
    ) return 'head';
    if (key === 'other') return 'other';
    return 'other';
  };

  const mergeChainTypes = (currentType, nextType) => {
    const current = normalizeChainType(currentType);
    const next = normalizeChainType(nextType);
    if (!current) return next;
    if (!next || current === next) return current;
    if (current === 'head' || next === 'head') return 'other';
    if (current === 'A-bar' || next === 'A-bar') return 'A-bar';
    if (current === 'A' || next === 'A') return 'A';
    return 'other';
  };

  const deriveChainTypeFromOperation = (operation) => {
    if (isABarLikeText(operation)) return 'A-bar';
    if (isALikeText(operation)) return 'A';
    const normalized = normalizeMovementOperation(operation);
    if (normalized === 'A-Move') return 'A';
    if (normalized === 'AbarMove') return 'A-bar';
    if (normalized === 'HeadMove') return 'head';
    const key = normalizeKey(operation);
    if (/head.*move|head.*raise|head.*lower|lower|lowering|affix|clitic|incorpor/.test(key)) return 'head';
    if (/amove|raise|raising/.test(key)) return 'A';
    if (/abar|wh|focus|topic|operator|front|displac|extract|scrambl|topicaliz|focaliz/.test(key)) return 'A-bar';
    return 'other';
  };

  return {
    normalizeKey,
    normalizeDerivationOperation,
    normalizeSpelloutOrder,
    normalizeOptionalStepText,
    normalizeOptionalStringArray,
    normalizeNodeIdArray,
    normalizeMovementOperation,
    normalizeIndexedText,
    extractMovementIndex,
    stripMovementIndex,
    normalizeOpenChainType,
    normalizeChainType,
    mergeChainTypes,
    deriveChainTypeFromOperation
  };
};
