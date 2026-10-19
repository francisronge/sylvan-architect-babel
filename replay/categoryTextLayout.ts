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
  const starts = [0, ...wrapBreaks(segments, fits)];
  const lines = starts.map((from, index) => segments.slice(from, starts[index + 1]).join(''));
  const width = Math.max(...lines.map(measure));
  const height = 52 + (lines.length - 1) * CATEGORY_LINE_HEIGHT;
  return { lines, width, height, x: -width / 2, y: -height - 4 };
}

type Fits = (from: number, to: number) => boolean;
type Wrap = { breaks: number[]; lines: number; splits: number; remnants: number };

const breakAfter = /^[\s,]/u, hyphen = /^[-\u2010]/u, wordCharacter = /^[\p{L}\p{N}]/u;
// Slashes, hyphens and dashes join separate words, so a line may end after one.
const joiner = /^[/\-\u2010\u2012-\u2015]/u;
// These scripts break between any two characters without splitting a word.
const breaksAnywhere = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const openingBracket = /^\p{Ps}/u, closingBracket = /^\p{Pe}/u;
// Closing brackets and quotes, clause punctuation, primes and bar-level marks
// complete the text before them, so no line starts with one.
const completesPrevious = /^[\p{Pe}\p{Pf},.;:!?、。，．：；！？′″‴'°⁰]/u;
const punctuationOnly = /^[\p{P}\p{S}\s]+$/u;

const insideWord = (segments: string[], index: number) => wordCharacter.test(segments[index - 1])
  && wordCharacter.test(segments[index] ?? '');
const splitsWord = (segments: string[], index: number) => insideWord(segments, index)
  && !breaksAnywhere.test(segments[index - 1]) && !breaksAnywhere.test(segments[index]);
// A later line of at most two graphemes, or of punctuation alone, is a remnant.
const isRemnant = (segments: string[], from: number, to: number) => {
  while (from < to && /^\s+$/u.test(segments[from])) from++;
  while (to > from && /^\s+$/u.test(segments[to - 1])) to--;
  if (to - from <= 2) return to > from;
  for (let index = from; index < to; index++) if (!punctuationOnly.test(segments[index])) return false;
  return true;
};
// Better in one respect and worse in none, so a repair never adds a line.
const improves = (candidate: Wrap, best: Wrap) => candidate.lines <= best.lines
  && candidate.splits <= best.splits && candidate.remnants <= best.remnants
  && (candidate.lines < best.lines || candidate.splits < best.splits || candidate.remnants < best.remnants);

/** The start of every line after the first. Greedy filling (`lineBreak`) ends
 * each line. Where the greedy wrapping from a line on splits a word or leaves a
 * remnant line, the other word-preserving breaks of that line are compared,
 * each with its own best wrapping of the rest, and one that `improves` on the
 * greedy break replaces it. A clean greedy wrapping is kept as it is, so labels
 * that already wrap cleanly keep their breaks and cost no extra probes. */
function wrapBreaks(segments: string[], fits: Fits): number[] {
  const wraps = new Map<number, Wrap & { greedyDefect: boolean }>();
  // Every line from a later start fits up to `known`, the earlier overflow.
  const overflow = (start: number, known: number) => {
    for (let end = Math.max(start + 1, known); end < segments.length; end++) {
      if (fits(start, end + 1)) continue;
      const split = lineBreak(segments, start, end, fits);
      if (split <= end) return { end, split };
    }
  };
  const wrapFrom = (start: number, known: number) => {
    const cached = wraps.get(start);
    if (cached) return cached;
    const found = overflow(start, known);
    let result: Wrap & { greedyDefect: boolean };
    if (!found) {
      const remnants = start > 0 && isRemnant(segments, start, segments.length) ? 1 : 0;
      result = { breaks: [], lines: 1, splits: 0, remnants, greedyDefect: remnants > 0 };
    } else {
      const option = (split: number): Wrap => {
        const rest = wrapFrom(split, found.end);
        return { breaks: [split, ...rest.breaks], lines: rest.lines + 1,
          splits: rest.splits + (splitsWord(segments, split) ? 1 : 0),
          remnants: rest.remnants + (start > 0 && isRemnant(segments, start, split) ? 1 : 0) };
      };
      let best = option(found.split);
      const greedyDefect = splitsWord(segments, found.split)
        || start > 0 && isRemnant(segments, start, found.split) || wrapFrom(found.split, found.end).greedyDefect;
      if (greedyDefect) for (const split of alternativeBreaks(segments, start, found.end, found.split)) {
        const candidate = option(split);
        if (improves(candidate, best)) best = candidate;
      }
      result = { ...best, greedyDefect };
    }
    wraps.set(start, result);
    return result;
  };
  return wrapFrom(0, 1).breaks;
}

/** Word-preserving breaks in the line from `start` that overflows at `end`,
 * latest first: after a space, comma, slash, hyphen or dash, or before an
 * opening bracket. No line starts with a space or completing mark. A greedy
 * break inside a word may also move back up to two graphemes, which keeps a
 * final remnant together with the end of its word. */
function alternativeBreaks(segments: string[], start: number, end: number, greedy: number) {
  const breaks: number[] = [];
  for (let index = end; index > start; index--) {
    const before = segments[index - 1], after = segments[index];
    if (index === greedy || /^\s/u.test(after) || completesPrevious.test(after)) continue;
    if (breakAfter.test(before)
      || openingBracket.test(after) && !openingBracket.test(before) && !/^\s/u.test(before)
      || index - 1 > start && joiner.test(before) && wordCharacter.test(segments[index - 2])
        && (wordCharacter.test(after) || openingBracket.test(after))) breaks.push(index);
  }
  if (insideWord(segments, greedy))
    for (const index of [greedy - 1, greedy - 2]) if (index > start + 1 && insideWord(segments, index)) breaks.push(index);
  return breaks;
}

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
function lineBreak(segments: string[], start: number, end: number, fits: Fits) {
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
