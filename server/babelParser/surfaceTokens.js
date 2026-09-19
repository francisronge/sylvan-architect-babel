const EDGE_PUNCTUATION_OR_SYMBOL_RE = /[\p{P}\p{S}]/u;
const EDGE_PUNCTUATION_RE = /\p{P}/u;
const WORDLIKE_CONTENT_RE = /[\p{L}\p{N}]/u;
const SYMBOL_CONTENT_RE = /[\p{S}\p{Co}\p{Extended_Pictographic}\u20E3]/u;
const POSSESSIVE_SUFFIX_RE =
  /^([\p{Script_Extensions=Latin}\p{M}\p{N}_-]+)(['\u2019]s)$/iu;
const FALLBACK_TOKEN_RE =
  /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['\u2019][\p{L}\p{M}\p{N}]+)*|[\p{S}\p{Co}\p{Extended_Pictographic}\u20E3](?:[\p{S}\p{Co}\p{M}\p{Extended_Pictographic}\u200C\u200D\uFE0E\uFE0F\u20E3])*/gu;

export const stripEdgePunctuationAndSymbols = (value) => {
  const text = String(value || '').normalize('NFC').trim();
  if (!text) return '';
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  const edgePattern = WORDLIKE_CONTENT_RE.test(text)
    ? EDGE_PUNCTUATION_OR_SYMBOL_RE
    : EDGE_PUNCTUATION_RE;
  while (start < end && edgePattern.test(chars[start])) start += 1;
  while (end > start && edgePattern.test(chars[end - 1])) end -= 1;
  const content = chars.slice(start, end).join('');
  if (!WORDLIKE_CONTENT_RE.test(content) && !SYMBOL_CONTENT_RE.test(content)) return '';
  return content;
};

export const normalizeSurfaceToken = (value) =>
  stripEdgePunctuationAndSymbols(value).toLowerCase().normalize('NFC');

/** Apply Unicode default casing to a complete code point, never half a surrogate pair. */
export const caseSurfaceInitial = (value, casing) => {
  const text = String(value || '');
  const first = Array.from(text)[0];
  if (!first) return text;
  return (casing === 'upper' ? first.toUpperCase() : first.toLowerCase()) + text.slice(first.length);
};

const splitSyntacticSurfaceToken = (token) => {
  const cleaned = stripEdgePunctuationAndSymbols(token);
  if (!cleaned || !WORDLIKE_CONTENT_RE.test(cleaned)) return [];

  const possessiveMatch = cleaned.match(POSSESSIVE_SUFFIX_RE);
  if (possessiveMatch?.[1] && possessiveMatch?.[2]) {
    return [possessiveMatch[1], possessiveMatch[2].replace(/\u2019/g, "'")];
  }

  return [cleaned];
};

const tokenizeWithSegmenter = (input) => {
  const wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' });
  const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
  const tokens = [];
  let symbolRun = '';
  const flushSymbolRun = () => {
    if (!symbolRun) return;
    tokens.push(symbolRun);
    symbolRun = '';
  };

  for (const part of wordSegmenter.segment(input)) {
    if (part.isWordLike || WORDLIKE_CONTENT_RE.test(part.segment)) {
      flushSymbolRun();
      tokens.push(...splitSyntacticSurfaceToken(part.segment));
      continue;
    }
    for (const grapheme of graphemeSegmenter.segment(part.segment)) {
      const normalized = grapheme.segment.normalize('NFC');
      if (SYMBOL_CONTENT_RE.test(normalized)) {
        symbolRun += normalized;
      } else {
        flushSymbolRun();
      }
    }
  }
  flushSymbolRun();
  return tokens;
};

export const tokenizeSentenceSurfaceOrder = (sentence) => {
  const input = String(sentence || '').normalize('NFC');
  if (!input.trim()) return [];

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return tokenizeWithSegmenter(input);
  }

  return Array.from(input.matchAll(FALLBACK_TOKEN_RE))
    .flatMap((match) => {
      const token = String(match[0] || '').normalize('NFC');
      return WORDLIKE_CONTENT_RE.test(token)
        ? splitSyntacticSurfaceToken(token)
        : [token];
    })
    .filter(Boolean);
};
