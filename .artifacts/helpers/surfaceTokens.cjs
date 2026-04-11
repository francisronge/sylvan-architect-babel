const EDGE_PUNCTUATION_OR_SYMBOL_RE = /[\p{P}\p{S}]/u;
const WORDLIKE_CONTENT_RE = /[\p{L}\p{M}\p{N}]/u;

function stripEdgePunctuationAndSymbols(value) {
  const text = String(value || '').normalize('NFC').trim();
  if (!text) return '';
  const chars = Array.from(text);
  let start = 0;
  let end = chars.length;
  while (start < end && EDGE_PUNCTUATION_OR_SYMBOL_RE.test(chars[start])) start += 1;
  while (end > start && EDGE_PUNCTUATION_OR_SYMBOL_RE.test(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join('');
}

function normalizeSurfaceToken(value) {
  return stripEdgePunctuationAndSymbols(value).toLocaleLowerCase('und');
}

function tokenizeSentenceSurfaceOrder(sentence) {
  const input = String(sentence || '').normalize('NFC');
  if (!input.trim()) return [];

  const whitespaceTokens = input
    .split(/\s+/)
    .map(stripEdgePunctuationAndSymbols)
    .filter((token) => token && WORDLIKE_CONTENT_RE.test(token));
  if (/\s/u.test(input) || whitespaceTokens.length > 1) {
    return whitespaceTokens;
  }

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    const tokens = [];
    for (const part of segmenter.segment(input)) {
      const cleaned = stripEdgePunctuationAndSymbols(part.segment);
      if (!cleaned) continue;
      if (part.isWordLike || WORDLIKE_CONTENT_RE.test(cleaned)) {
        tokens.push(cleaned);
      }
    }
    if (tokens.length > 0) return tokens;
  }

  return whitespaceTokens;
}

function sameSeq(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (normalizeSurfaceToken(left[index]) !== normalizeSurfaceToken(right[index])) return false;
  }
  return true;
}

module.exports = {
  stripEdgePunctuationAndSymbols,
  normalizeSurfaceToken,
  tokenizeSentenceSurfaceOrder,
  sameSeq
};
