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

/**
 * A token made only of punctuation (and spacing). Each analysis decides whether
 * such punctuation is a syntactic word, so an analysis may leave it unclaimed.
 */
export const isPunctuationOnlyToken = (value) => /^[\p{P}\p{White_Space}\u200B]+$/u.test(String(value).normalize('NFC'));

export const normalizeSurfaceToken = (value) =>
  stripEdgePunctuationAndSymbols(value).toLowerCase().normalize('NFC');

/**
 * Places words, in order, on the input tokens and returns each word's token
 * index, or null. A word takes the next token whose surface form it shares; a
 * punctuation-only token the next word does not take stays unclaimed, because
 * an analysis may leave out punctuation that another analysis of the response
 * writes as a word. When the words match the tokens one for one, every word
 * takes its own token.
 */
export const alignWordsToTokens = (words, tokens) => {
  const indices = [];
  let index = 0;
  const skipPunctuation = (form) => {
    while (index < tokens.length && normalizeSurfaceToken(tokens[index]) !== form && isPunctuationOnlyToken(tokens[index])) index += 1;
  };
  for (const word of words) {
    const form = normalizeSurfaceToken(word);
    skipPunctuation(form);
    if (index === tokens.length || normalizeSurfaceToken(tokens[index]) !== form) return null;
    indices.push(index);
    index += 1;
  }
  skipPunctuation(undefined);
  return index === tokens.length ? indices : null;
};

/** Apply Unicode default casing to a complete code point, never half a surrogate pair. */
export const caseSurfaceInitial = (value, casing) => {
  const text = String(value || '');
  const first = Array.from(text)[0];
  if (!first) return text;
  return (casing === 'upper' ? first.toUpperCase() : first.toLowerCase()) + text.slice(first.length);
};

const splitSyntacticSurfaceToken = (token, legacyPossessives) => {
  const cleaned = stripEdgePunctuationAndSymbols(token);
  if (!cleaned || !WORDLIKE_CONTENT_RE.test(cleaned)) return [];

  const possessiveMatch = legacyPossessives && cleaned.match(POSSESSIVE_SUFFIX_RE);
  if (possessiveMatch?.[1] && possessiveMatch?.[2]) {
    return [possessiveMatch[1], possessiveMatch[2].replace(/\u2019/g, "'")];
  }

  return [cleaned];
};

const tokenizeWithSegmenter = (input, legacyPossessives) => {
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
      tokens.push(...splitSyntacticSurfaceToken(part.segment, legacyPossessives));
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

const tokenizeSurface = (sentence, legacyPossessives = false) => {
  const input = String(sentence || '').normalize('NFC');
  if (!input.trim()) return [];

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return tokenizeWithSegmenter(input, legacyPossessives);
  }

  return Array.from(input.matchAll(FALLBACK_TOKEN_RE))
    .flatMap((match) => {
      const token = String(match[0] || '').normalize('NFC');
      return WORDLIKE_CONTENT_RE.test(token)
        ? splitSyntacticSurfaceToken(token, legacyPossessives)
        : [token];
    })
    .filter(Boolean);
};

export const tokenizeSentenceSurfaceOrder = (sentence) => tokenizeSurface(sentence);

/** Old saved records predate inputTokens. Keep their original apostrophe-s addresses. */
export const resolveSavedInputTokens = (sentence, inputTokens) => {
  if (inputTokens === undefined) return tokenizeSurface(sentence, true);
  if (!Array.isArray(inputTokens) || inputTokens.some(token => typeof token !== 'string' || !token.trim())) {
    throw new TypeError('inputTokens must be an array of nonempty strings.');
  }
  return inputTokens.slice();
};
