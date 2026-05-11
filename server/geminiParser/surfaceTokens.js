const EDGE_PUNCTUATION_OR_SYMBOL_RE = /[\p{P}\p{S}]/u;
const WORDLIKE_CONTENT_RE = /[\p{L}\p{M}\p{N}]/u;
const POSSESSIVE_SUFFIX_RE = /^(.+?)(['\u2019]s)$/iu;

export const stripEdgePunctuationAndSymbols = (value) => {
  const text = String(value || '').normalize('NFC').trim();
  if (!text) return '';
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_PUNCTUATION_OR_SYMBOL_RE.test(chars[start])) start += 1;
  while (end > start && EDGE_PUNCTUATION_OR_SYMBOL_RE.test(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join('');
};

export const normalizeSurfaceToken = (value) =>
  stripEdgePunctuationAndSymbols(value).toLocaleLowerCase('und');

const splitSyntacticSurfaceToken = (token) => {
  const cleaned = stripEdgePunctuationAndSymbols(token);
  if (!cleaned || !WORDLIKE_CONTENT_RE.test(cleaned)) return [];

  const possessiveMatch = cleaned.match(POSSESSIVE_SUFFIX_RE);
  if (possessiveMatch?.[1] && possessiveMatch?.[2]) {
    return [possessiveMatch[1], possessiveMatch[2].replace(/\u2019/g, "'")];
  }

  return [cleaned];
};

export const tokenizeSentenceSurfaceOrder = (sentence) => {
  const input = String(sentence || '').normalize('NFC');
  if (!input.trim()) return [];

  const whitespaceTokens = input
    .split(/\s+/)
    .flatMap(splitSyntacticSurfaceToken);
  if (/\s/u.test(input) || whitespaceTokens.length > 1) {
    return whitespaceTokens;
  }

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const tokens = [];
    for (const part of segmenter.segment(input)) {
      const pieces = splitSyntacticSurfaceToken(part.segment);
      if (pieces.length === 0) continue;
      if (part.isWordLike || pieces.some((piece) => WORDLIKE_CONTENT_RE.test(piece))) {
        tokens.push(...pieces);
      }
    }
    if (tokens.length > 0) return tokens;
  }

  return whitespaceTokens;
};
