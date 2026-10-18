/** The counting step of the one-letter-per-label rule (PR #75,
 * checkOneLetterPerLabel in tests/helpers/replayInvariants.mjs on
 * fix/renderer-single-index-letter): every index letter a drawn mark asserts at
 * an occurrence label is shown there exactly once, counting a letter beside the
 * label, an inline coindex and a subscript written into the label. Measurement
 * stays with its source: #75 paints letters offline and knows the asserted
 * letters from the plan; a browser probe observes painted letters and their
 * placement attributes, so it can report a repeated letter but not a missing one.
 *
 * `shown` and `asserted` map a label id to Map(letter → count) and Set(letter).
 * Returns `{ label, letter, count }` for each asserted letter not shown once. */
export function countLabelLetters(shown, asserted) {
  const out = [];
  for (const [label, letters] of asserted) for (const letter of letters) {
    const count = shown.get(label)?.get(letter) ?? 0;
    if (count !== 1) out.push({ label, letter, count });
  }
  return out;
}

/** Adds one shown letter at a label to a `shown` map. */
export function showLetter(shown, label, letter) {
  if (!label || !letter) return shown;
  const letters = shown.get(label) ?? new Map();
  return shown.set(label, letters.set(letter, (letters.get(letter) ?? 0) + 1));
}
