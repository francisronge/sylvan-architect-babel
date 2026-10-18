export type CategoryTextMeasure = (text: string) => number;
export const CATEGORY_FONT = '900 42px Quicksand, sans-serif';
export const CATEGORY_LINE_HEIGHT = 48;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const fallbackMeasure: CategoryTextMeasure = value => [...value].length * 25;
const layouts = new WeakMap<CategoryTextMeasure, Map<string, ReturnType<typeof wrapCategoryText>>>();

/** A measurement callback represents one immutable font state. Keep wrapping
 * local to that callback so new font collectors still receive every probe. */
export function categoryTextLayout(text: string, measure: CategoryTextMeasure = fallbackMeasure) {
  let cache = layouts.get(measure);
  if (!cache) layouts.set(measure, cache = new Map());
  let layout = cache.get(text);
  if (!layout) {
    layout = wrapCategoryText(text, measure);
    cache.set(text, layout);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
  }
  return { ...layout, lines: [...layout.lines] };
}

/** Wrap display text without abbreviating, interpreting or changing its characters. */
function wrapCategoryText(text: string, measure: CategoryTextMeasure) {
  const maxWidth = 380;
  const unwrappedWidth = measure(text);
  if (unwrappedWidth <= maxWidth) return { lines: [text], width: unwrappedWidth, height: 52, x: -unwrappedWidth / 2, y: -56 };
  const segments = [...graphemes.segment(text)].map(part => part.segment);
  const fits = (from: number, to: number) => measure(segments.slice(from, to).join('')) <= maxWidth;
  const lines: string[] = [];
  let start = 0;
  for (let end = 1; end < segments.length; end++) {
    while (start < end && !fits(start, end + 1)) {
      const split = lineBreak(segments, start, end, fits);
      if (split > end) break;
      lines.push(segments.slice(start, split).join(''));
      start = split;
    }
  }
  lines.push(segments.slice(start).join(''));
  const width = Math.max(...lines.map(measure));
  const height = 52 + (lines.length - 1) * CATEGORY_LINE_HEIGHT;
  return { lines, width, height, x: -width / 2, y: -height - 4 };
}

const breakAfter = /^[\s,]/u, hyphen = /^[-\u2010]/u, wordCharacter = /^[\p{L}\p{N}]/u;
const openingBracket = /^\p{Ps}/u, closingBracket = /^\p{Pe}/u;
// Closing brackets and quotes, clause punctuation, primes and bar-level marks
// complete the text before them, so no line starts with one.
const completesPrevious = /^[\p{Pe}\p{Pf},.;:!?、。，．：；！？′″‴'°⁰]/u;

/** Choose where a line ends when grapheme `end` overflows the graphemes from
 * `start`; the line keeps graphemes before the returned index, and an index
 * past `end` keeps the overflowing grapheme on the line. Prefer the last space
 * or comma, then a break before an overflowing space, which already ends a
 * word. An overflowing completing mark then hangs past the width rather than
 * start a line, so it never adds one. Otherwise take the latest of two
 * word-preserving breaks: after a hyphen joining two word characters when the
 * rest of the label fits on one line, so the break never adds a line, or before
 * an opening bracket whose complete group, with any text attached up to the
 * next space or comma, fits on one line. Otherwise break before the overflowing
 * grapheme. Lines exceed the width only by hanging marks or a single wider
 * grapheme. */
function lineBreak(segments: string[], start: number, end: number, fits: (from: number, to: number) => boolean) {
  for (let index = end; index > start; index--)
    if (breakAfter.test(segments[index - 1]) && !completesPrevious.test(segments[index])) return index;
  if (/^\s/u.test(segments[end])) return end;
  if (completesPrevious.test(segments[end])) return end + 1;
  const afterHyphen = (index: number) => index - 1 > start && hyphen.test(segments[index - 1])
    && wordCharacter.test(segments[index - 2]) && wordCharacter.test(segments[index]) && fits(index, segments.length);
  const beforeBracket = (index: number) => {
    if (index === end || !openingBracket.test(segments[index])) return false;
    let depth = 0, group = index;
    while (group < segments.length) {
      const segment = segments[group++];
      if (openingBracket.test(segment)) depth++;
      else if (closingBracket.test(segment)) depth--;
      else if (depth <= 0 && breakAfter.test(segment)) break;
    }
    return fits(index, group);
  };
  for (let index = end; index > start; index--) if (afterHyphen(index) || beforeBracket(index)) return index;
  return end;
}
